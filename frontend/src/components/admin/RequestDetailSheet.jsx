import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertCircle, Ban, Check, CheckCircle2, Loader2, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { toast } from '../../hooks/use-toast';
import { cn } from '../../lib/utils';
import { LIMITS, STATUS_LABELS, apiErrorMessage, fieldErrorsFromResponse } from '../../lib/requests';
import {
  browserTimeZone,
  formatCalendarDate,
  formatDateTime,
  toDateTimeLocalValue,
  toIsoWithOffset,
  zonedTimeToDate,
} from '../../lib/datetime';
import { StatusBadge, TypeBadge } from './badges';
import { isHandledStatus } from './adminApi';

const ACTIONS = {
  confirmed: {
    label: 'Confirm',
    icon: Check,
    done: 'Request confirmed',
    className: 'bg-emerald-400 text-black hover:bg-emerald-300',
  },
  declined: {
    label: 'Decline',
    icon: Ban,
    done: 'Request declined',
    className: 'border border-red-500/50 text-red-300 hover:bg-red-500/10',
  },
  completed: {
    label: 'Mark completed',
    icon: CheckCircle2,
    done: 'Marked as completed',
    className: 'border border-gray-700 text-white hover:border-cyan-400 hover:text-cyan-400',
  },
  new: {
    label: 'Reopen',
    icon: RotateCcw,
    done: 'Request reopened',
    className: 'border border-gray-700 text-white hover:border-cyan-400 hover:text-cyan-400',
  },
};

const buttonBase =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-50';

const textareaClass =
  'border-gray-800 bg-[#0a0a0a] text-white placeholder:text-gray-600 focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30 aria-[invalid=true]:border-red-500/70';

function initialSchedule(doc) {
  if (doc?.type !== 'appointment') return '';
  const stored = doc.scheduled_at ? new Date(doc.scheduled_at) : null;
  if (stored && !Number.isNaN(stored.getTime())) return toDateTimeLocalValue(stored);
  const requested = zonedTimeToDate(doc.preferred_date, doc.preferred_time, doc.timezone);
  if (requested) return toDateTimeLocalValue(requested);
  return doc.preferred_date && doc.preferred_time ? `${doc.preferred_date}T${doc.preferred_time}` : '';
}

function parseLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function Detail({ label, children, className }) {
  return (
    <div className={className}>
      <dt className="font-mono text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-gray-200">{children}</dd>
    </div>
  );
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-sm text-red-400">
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

function historyText(entry) {
  const to = entry?.status ?? entry?.to;
  const from = entry?.from;
  if (from && to) return `${STATUS_LABELS[from] || from} → ${STATUS_LABELS[to] || to}`;
  return to ? `Status set to ${STATUS_LABELS[to] || to}` : 'Updated';
}

const RequestDetailSheet = ({ api, request, open, onOpenChange, emailEnabled, onUpdated, onDeleted }) => {
  const [doc, setDoc] = useState(request);
  const [adminNote, setAdminNote] = useState(request.admin_note || '');
  const [scheduled, setScheduled] = useState(() => initialSchedule(request));
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [notifyClient, setNotifyClient] = useState(false);
  const [clientMessage, setClientMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get(`/requests/${encodeURIComponent(request.id)}`, { signal: controller.signal })
      .then(({ data }) => {
        if (!data?.id) return;
        setDoc(data);
        setAdminNote((prev) => (prev === (request.admin_note || '') ? data.admin_note || '' : prev));
        setScheduled((prev) => (prev === initialSchedule(request) ? initialSchedule(data) : prev));
      })
      .catch((err) => {
        if (axios.isCancel(err) || isHandledStatus(err)) return;
        if (err.response?.status === 404) {
          toast({ variant: 'destructive', title: 'Request not found', description: 'It may have been deleted.' });
          onDeleted();
        }
      });
    return () => controller.abort();
  }, [api, request, onDeleted]);

  const isAppointment = doc.type === 'appointment';
  const adminZone = browserTimeZone();
  const requestedInstant = isAppointment
    ? zonedTimeToDate(doc.preferred_date, doc.preferred_time, doc.timezone)
    : null;
  const scheduledDate = parseLocal(scheduled);
  const storedScheduledMs = doc.scheduled_at ? Date.parse(doc.scheduled_at) : NaN;

  const buildBody = (nextStatus) => {
    const body = {};
    const errors = {};
    if (nextStatus) body.status = nextStatus;
    if (adminNote !== (doc.admin_note || '')) {
      if ([...adminNote].length > LIMITS.admin_note) {
        errors.admin_note = `The note must be ${LIMITS.admin_note} characters or fewer.`;
      }
      body.admin_note = adminNote;
    }
    if (isAppointment && nextStatus !== 'declined') {
      if (scheduled && !scheduledDate) {
        errors.scheduled_at = 'Please enter a valid date and time.';
      } else if (
        scheduledDate &&
        (nextStatus === 'confirmed' || (scheduleTouched && scheduledDate.getTime() !== storedScheduledMs))
      ) {
        body.scheduled_at = toIsoWithOffset(scheduledDate);
      }
    }
    if (notifyClient) {
      body.notify_client = true;
      const message = clientMessage.trim();
      if ([...message].length > LIMITS.client_message) {
        errors.client_message = `The message must be ${LIMITS.client_message} characters or fewer.`;
      }
      if (message) body.client_message = message;
    }
    return { body, errors };
  };

  const submit = async (nextStatus) => {
    const { body, errors } = buildBody(nextStatus);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    if (!Object.keys(body).length) {
      toast({
        title: 'Nothing to save',
        description: isAppointment ? 'Change the note or the scheduled time first.' : 'Change the note first.',
      });
      return;
    }
    setBusy(nextStatus || 'save');
    try {
      const { data } = await api.patch(`/requests/${encodeURIComponent(doc.id)}`, body);
      const updated = data?.id ? data : { ...doc, ...body };
      setDoc(updated);
      setAdminNote(updated.admin_note || '');
      setScheduled(initialSchedule(updated));
      setScheduleTouched(false);
      setNotifyClient(false);
      setClientMessage('');
      toast({
        title: nextStatus ? ACTIONS[nextStatus].done : 'Changes saved',
        description: body.notify_client
          ? data?.client_notified
            ? `The client was emailed at ${doc.email}.`
            : 'The client was NOT emailed. Email is not configured on the server or sending failed.'
          : 'The client was not emailed.',
      });
      onUpdated();
    } catch (err) {
      if (isHandledStatus(err)) return;
      const status = err.response?.status;
      if (status === 404) {
        toast({ variant: 'destructive', title: 'Request not found', description: 'It may have been deleted.' });
        onDeleted();
        return;
      }
      const serverErrors = status === 422 ? fieldErrorsFromResponse(err.response.data) : null;
      const shown = {};
      for (const field of ['admin_note', 'scheduled_at', 'client_message']) {
        if (serverErrors?.[field]) shown[field] = serverErrors[field];
      }
      setFieldErrors(shown);
      const other = serverErrors
        ? Object.entries(serverErrors)
            .filter(([field]) => !shown[field])
            .map(([, message]) => message)
            .join(' ')
        : '';
      if (!serverErrors || other) {
        toast({
          variant: 'destructive',
          title: 'Update failed',
          description: other || apiErrorMessage(err, 'Could not update the request.'),
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    setBusy('delete');
    try {
      await api.delete(`/requests/${encodeURIComponent(doc.id)}`);
      toast({ title: 'Request deleted', description: `The request from ${doc.name} was removed.` });
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      if (isHandledStatus(err)) return;
      if (err.response?.status === 404) {
        setConfirmDelete(false);
        onDeleted();
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: apiErrorMessage(err, 'Could not delete the request.'),
      });
    } finally {
      setBusy(null);
    }
  };

  const history = Array.isArray(doc.history) ? doc.history : [];
  const mailto = `mailto:${doc.email}?subject=${encodeURIComponent(`Re: ${doc.subject || 'your request'}`)}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 border-gray-800 bg-[#0f0f10] p-0 text-white sm:max-w-xl"
      >
        <SheetHeader className="space-y-3 border-b border-gray-800 p-5 pr-12 text-left sm:p-6 sm:pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={doc.type} />
            <StatusBadge status={doc.status} />
          </div>
          <SheetTitle className="break-words text-xl text-white">{doc.subject}</SheetTitle>
          <SheetDescription className="text-gray-500">
            From {doc.name} · received {formatDateTime(doc.created_at)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-8 overflow-y-auto p-5 sm:p-6">
          <dl className="grid gap-5 sm:grid-cols-2">
            <Detail label="Name">{doc.name}</Detail>
            <Detail label="Email">
              <a href={mailto} className="text-cyan-400 underline-offset-4 hover:underline">
                {doc.email}
              </a>
            </Detail>
            <Detail label="Discord / Telegram">{doc.contact_handle || <span className="text-gray-600">-</span>}</Detail>
            <Detail label="Service">{doc.service || <span className="text-gray-600">-</span>}</Detail>
            {doc.type === 'revision' && (
              <Detail label="Project reference" className="sm:col-span-2">
                {doc.project_reference}
              </Detail>
            )}
            {isAppointment && (
              <Detail label="Requested time" className="sm:col-span-2">
                <span className="text-white">
                  {formatCalendarDate(doc.preferred_date)} · {doc.preferred_time}
                </span>{' '}
                <span className="text-gray-400">
                  ({doc.timezone}
                  {doc.duration_minutes ? `, ${doc.duration_minutes} min` : ''})
                </span>
                {requestedInstant && doc.timezone !== adminZone && (
                  <span className="mt-1 block text-xs text-gray-500">
                    {formatDateTime(requestedInstant)} your time ({adminZone})
                  </span>
                )}
              </Detail>
            )}
            {isAppointment && doc.scheduled_at && (
              <Detail label="Scheduled for" className="sm:col-span-2">
                {formatDateTime(doc.scheduled_at)} your time
              </Detail>
            )}
            <Detail label="Received">{formatDateTime(doc.created_at)}</Detail>
            <Detail label="Last updated">{formatDateTime(doc.updated_at || doc.created_at)}</Detail>
            <Detail label="ID" className="sm:col-span-2">
              <span className="font-mono text-xs text-gray-400">{doc.id}</span>
            </Detail>
          </dl>

          <section>
            <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-gray-500">Message</h3>
            <div className="whitespace-pre-wrap break-words rounded-lg border border-gray-800 bg-[#0a0a0a] p-4 text-sm leading-relaxed text-gray-200">
              {doc.message}
            </div>
          </section>

          {history.length > 0 && (
            <section>
              <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-gray-500">History</h3>
              <ol className="space-y-2 border-l border-gray-800 pl-4">
                {history.map((entry, index) => {
                  const at = entry?.at ?? entry?.changed_at ?? entry?.timestamp;
                  return (
                    <li key={index} className="text-sm text-gray-400">
                      <span className="text-gray-200">{historyText(entry)}</span>
                      {at && <span> · {formatDateTime(at)}</span>}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section className="space-y-5 rounded-xl border border-gray-800 p-4 sm:p-5">
            <h3 className="font-mono text-xs uppercase tracking-wider text-cyan-400">Update</h3>

            {isAppointment && (
              <div>
                <Label htmlFor="detail-scheduled" className="mb-2 block text-sm text-gray-400">
                  Scheduled for
                </Label>
                <Input
                  id="detail-scheduled"
                  type="datetime-local"
                  value={scheduled}
                  onChange={(e) => {
                    setScheduled(e.target.value);
                    setScheduleTouched(true);
                  }}
                  aria-invalid={fieldErrors.scheduled_at ? true : undefined}
                  aria-describedby="detail-scheduled-hint"
                  className="h-10 border-gray-800 bg-[#0a0a0a] text-white [color-scheme:dark] focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30 aria-[invalid=true]:border-red-500/70"
                />
                <p id="detail-scheduled-hint" className="mt-2 text-xs text-gray-500">
                  Your local time ({adminZone}).{' '}
                  {doc.scheduled_at
                    ? 'Prefilled from the scheduled time.'
                    : requestedInstant
                      ? "Prefilled from the client's requested time."
                      : "The client's timezone could not be converted, so the requested time is shown as is."}{' '}
                  Sent when you confirm or save.
                </p>
                <FieldError message={fieldErrors.scheduled_at} />
              </div>
            )}

            <div>
              <Label htmlFor="detail-note" className="mb-2 block text-sm text-gray-400">
                Admin note <span className="text-xs text-gray-600">(only visible here)</span>
              </Label>
              <Textarea
                id="detail-note"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                maxLength={LIMITS.admin_note}
                rows={3}
                aria-invalid={fieldErrors.admin_note ? true : undefined}
                className={textareaClass}
              />
              <FieldError message={fieldErrors.admin_note} />
            </div>

            <div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="detail-notify"
                  checked={notifyClient}
                  onCheckedChange={(checked) => setNotifyClient(checked === true)}
                  disabled={!emailEnabled}
                  aria-describedby="detail-notify-hint"
                  className="mt-0.5 border-gray-600 data-[state=checked]:border-cyan-400"
                />
                <div>
                  <Label htmlFor="detail-notify" className="text-sm text-gray-200">
                    Email the client about this update
                  </Label>
                  <p id="detail-notify-hint" className="mt-1 text-xs text-gray-500">
                    {emailEnabled
                      ? `Sent to ${doc.email} with the new status${isAppointment ? ' and scheduled time' : ''}.`
                      : 'Email is not configured on the server, so the client cannot be emailed.'}
                  </p>
                </div>
              </div>
              {notifyClient && (
                <div className="mt-4">
                  <Label htmlFor="detail-client-message" className="mb-2 block text-sm text-gray-400">
                    Message to the client <span className="text-xs text-gray-600">(optional)</span>
                  </Label>
                  <Textarea
                    id="detail-client-message"
                    value={clientMessage}
                    onChange={(e) => setClientMessage(e.target.value)}
                    maxLength={LIMITS.client_message}
                    rows={3}
                    aria-invalid={fieldErrors.client_message ? true : undefined}
                    className={textareaClass}
                  />
                  <FieldError message={fieldErrors.client_message} />
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 bg-[#0a0a0a] p-4 sm:px-6">
          {Object.entries(ACTIONS)
            .filter(([status]) => status !== doc.status)
            .map(([status, action]) => {
              const Icon = action.icon;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => submit(status)}
                  disabled={Boolean(busy)}
                  className={cn(buttonBase, action.className)}
                >
                  {busy === status ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Icon size={14} aria-hidden="true" />
                  )}
                  {action.label}
                </button>
              );
            })}
          <button
            type="button"
            onClick={() => submit(null)}
            disabled={Boolean(busy)}
            className={cn(buttonBase, 'border border-gray-700 text-white hover:border-cyan-400 hover:text-cyan-400')}
          >
            {busy === 'save' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Save size={14} aria-hidden="true" />
            )}
            {isAppointment ? 'Save changes' : 'Save note'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={Boolean(busy)}
            className={cn(buttonBase, 'ml-auto text-red-400 hover:bg-red-500/10 hover:text-red-300')}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={(value) => busy !== 'delete' && setConfirmDelete(value)}>
          <AlertDialogContent className="border-gray-800 bg-[#0f0f10] text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this request?</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-400">
                The request from {doc.name} will be removed permanently. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-gray-700 bg-transparent text-white hover:bg-gray-800 hover:text-white">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={busy === 'delete'}
                className="gap-2 bg-red-500 text-white hover:bg-red-400"
              >
                {busy === 'delete' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Delete request
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
};

export default RequestDetailSheet;
