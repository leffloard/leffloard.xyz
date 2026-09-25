import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Globe,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  API_BASE,
  DURATIONS,
  LIMITS,
  MAX_DAYS_AHEAD,
  REQUEST_TYPES,
  SERVICES,
  fieldErrorsFromResponse,
} from '../lib/requests';
import {
  TIME_SLOTS,
  addDays,
  browserTimeZone,
  formatCalendarDate,
  parseISODate,
  startOfToday,
  toISODate,
} from '../lib/datetime';
import { toast } from '../hooks/use-toast';
import { personalInfo } from '../data/mock';
import { RadioGroup } from './ui/radio-group';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const TYPE_OPTIONS = [
  {
    value: 'appointment',
    label: 'Book a call',
    icon: CalendarClock,
    description: "Pick a time that suits you and I'll confirm it by email.",
    submit: 'Request a call',
  },
  {
    value: 'revision',
    label: 'Request a revision',
    icon: RefreshCw,
    description: "Ask for changes to work I've already delivered to you.",
    submit: 'Send revision request',
  },
  {
    value: 'inquiry',
    label: 'General inquiry',
    icon: MessageSquare,
    description: 'Questions, quotes, new projects or anything else.',
    submit: 'Send message',
  },
];

const NO_SERVICE = 'none';

const EMPTY_VALUES = {
  name: '',
  email: '',
  contact_handle: '',
  service: '',
  subject: '',
  message: '',
  project_reference: '',
  preferred_date: '',
  preferred_time: '',
  duration_minutes: '30',
  website: '',
};

const FIELD_ORDER = [
  'name',
  'email',
  'contact_handle',
  'service',
  'preferred_date',
  'preferred_time',
  'duration_minutes',
  'project_reference',
  'subject',
  'message',
];

const TYPE_FIELDS = {
  appointment: ['preferred_date', 'preferred_time', 'duration_minutes', 'timezone'],
  revision: ['project_reference'],
  inquiry: [],
};

const COMMON_FIELDS = ['name', 'email', 'contact_handle', 'service', 'subject', 'message'];

const TEXT_RULES = {
  name: { label: 'Name', required: 'Please enter your name.' },
  email: { label: 'Email', required: 'Please enter your email address.' },
  contact_handle: { label: 'Handle' },
  subject: { label: 'Subject', required: 'Please enter a subject.' },
  message: { label: 'Message', required: 'Please enter a message.', multiline: true },
  project_reference: {
    label: 'Project reference',
    required: 'Please tell me which project or order this is about.',
  },
};

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROL_CHARS_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldId = (name) => `request-${name}`;
const charCount = (value) => [...value].length;

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function isFieldActive(type, field) {
  return COMMON_FIELDS.includes(field) || TYPE_FIELDS[type].includes(field);
}

function validate(type, values) {
  const errors = {};
  for (const [field, rule] of Object.entries(TEXT_RULES)) {
    if (!isFieldActive(type, field)) continue;
    const value = values[field].trim();
    const required = rule.required && (field !== 'project_reference' || type === 'revision');
    if (!value) {
      if (required) errors[field] = rule.required;
      continue;
    }
    if (charCount(value) > LIMITS[field]) {
      errors[field] = `${rule.label} must be ${LIMITS[field]} characters or fewer.`;
    } else if ((rule.multiline ? CONTROL_CHARS_MULTILINE : CONTROL_CHARS).test(value)) {
      errors[field] = `${rule.label} contains characters that are not allowed.`;
    }
  }

  if (!errors.email && values.email.trim() && !EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }

  if (type === 'appointment') {
    const today = startOfToday();
    const date = parseISODate(values.preferred_date);
    if (!values.preferred_date) {
      errors.preferred_date = 'Please pick a date.';
    } else if (!date || date < today || date > addDays(today, MAX_DAYS_AHEAD)) {
      errors.preferred_date = `Please pick a date within the next ${MAX_DAYS_AHEAD} days.`;
    }
    if (!values.preferred_time) {
      errors.preferred_time = 'Please pick a time.';
    } else if (values.preferred_date === toISODate(today) && values.preferred_time <= currentTime()) {
      errors.preferred_time = 'Please pick a time later than now.';
    }
    if (!DURATIONS.includes(Number(values.duration_minutes))) {
      errors.duration_minutes = 'Please choose a call length.';
    }
  }
  return errors;
}

function buildPayload(type, values, timeZone) {
  const trimmed = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
  );
  const payload = {
    type,
    name: trimmed.name,
    email: trimmed.email,
    subject: trimmed.subject,
    message: trimmed.message,
    website: values.website,
  };
  if (trimmed.contact_handle) payload.contact_handle = trimmed.contact_handle;
  if (trimmed.service) payload.service = trimmed.service;
  if (type === 'appointment') {
    payload.preferred_date = trimmed.preferred_date;
    payload.preferred_time = trimmed.preferred_time;
    payload.timezone = timeZone;
    payload.duration_minutes = Number(trimmed.duration_minutes);
  }
  if (type === 'revision') payload.project_reference = trimmed.project_reference;
  return payload;
}

const fieldClass =
  'h-12 w-full rounded-lg border border-gray-800 bg-[#0f0f10] px-4 text-base text-white shadow-none transition-colors placeholder:text-gray-600 md:text-base focus:border-cyan-400 focus-visible:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus-visible:ring-2 focus-visible:ring-cyan-400/30 aria-[invalid=true]:border-red-500/70';

function Field({ name, label, optional, hint, error, className, children }) {
  const id = fieldId(name);
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <Label
        htmlFor={id}
        id={`${id}-label`}
        className="mb-2 flex items-baseline gap-2 text-sm font-medium text-gray-400"
      >
        {label}
        {optional && <span className="text-xs font-normal text-gray-600">Optional</span>}
      </Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-2 flex items-start gap-1.5 text-sm text-red-400">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function readQuery(search) {
  const params = new URLSearchParams(search);
  const type = params.get('type');
  const service = params.get('service');
  const subject = (params.get('subject') || '').trim();
  return {
    type: REQUEST_TYPES.includes(type) ? type : null,
    service: SERVICES.includes(service) ? service : null,
    subject: subject ? [...subject].slice(0, LIMITS.subject).join('') : null,
  };
}

function RequestSuccess({ result, headingRef, onReset }) {
  const firstName = result.name.split(/\s+/)[0];
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
      <div className="mb-6 rounded-full bg-cyan-400/10 p-4">
        <CheckCircle2 className="text-cyan-400" size={40} aria-hidden="true" />
      </div>
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold text-white outline-none"
      >
        Request received
      </h3>
      <p className="mt-3 max-w-md text-gray-400">
        Thanks{firstName ? `, ${firstName}` : ''}!{' '}
        {result.type === 'appointment'
          ? "I'll confirm the time by email within 24 hours."
          : "I'll reply by email within 24 hours."}
      </p>
      <ul className="mt-6 w-full max-w-md space-y-3 rounded-lg border border-gray-800 bg-[#0f0f10] p-4 text-left text-sm text-gray-400">
        <li className="flex gap-3">
          <span className="font-mono text-cyan-400">01</span>
          <span>
            {result.type === 'appointment'
              ? 'I check the requested time against my calendar.'
              : result.type === 'revision'
                ? 'I review the requested changes against the delivered work.'
                : 'I read your message and look into what you need.'}
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-cyan-400">02</span>
          <span>
            You get an email at <span className="break-words text-white">{result.email}</span>. Check your spam
            folder if nothing arrives.
          </span>
        </li>
      </ul>
      {result.id && (
        <p className="mt-4 font-mono text-xs text-gray-600">Reference: {result.id.slice(0, 8)}</p>
      )}
      <button
        type="button"
        onClick={onReset}
        className="mt-8 rounded-lg border border-gray-700 px-6 py-3 text-sm font-medium text-white transition-colors hover:border-cyan-400 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        Send another request
      </button>
    </div>
  );
}

const RequestForm = () => {
  const location = useLocation();
  const [initialQuery] = useState(() => readQuery(location.search));
  const [type, setType] = useState(initialQuery.type || 'inquiry');
  const [values, setValues] = useState(() => ({
    ...EMPTY_VALUES,
    service: initialQuery.service || '',
    subject: initialQuery.subject || '',
  }));
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const prefilledSubject = useRef(initialQuery.subject);
  const appliedKey = useRef(location.key);
  const successHeading = useRef(null);
  const errorToast = useRef(null);
  const timeZone = useMemo(browserTimeZone, []);

  useEffect(() => {
    if (appliedKey.current === location.key) return;
    appliedKey.current = location.key;
    const query = readQuery(location.search);
    if (!query.type && !query.service && !query.subject) return;
    if (query.type) setType(query.type);
    setValues((prev) => {
      const next = { ...prev };
      if (query.service) next.service = query.service;
      if (query.subject && (!prev.subject || prev.subject === prefilledSubject.current)) {
        next.subject = query.subject;
        prefilledSubject.current = query.subject;
      }
      return next;
    });
    setResult(null);
  }, [location.key, location.search]);

  useEffect(() => {
    if (result) successHeading.current?.focus();
  }, [result]);

  const today = startOfToday();
  const maxDate = addDays(today, MAX_DAYS_AHEAD);
  const selectedDate = parseISODate(values.preferred_date);
  const isToday = values.preferred_date === toISODate(today);
  const nowTime = currentTime();
  const activeOption = TYPE_OPTIONS.find((option) => option.value === type);

  const refreshErrors = (nextType, nextValues, changedFields) => {
    setErrors((prev) => {
      const next = {};
      for (const [field, message] of Object.entries(prev)) {
        if (!changedFields.includes(field) && (field === '_form' || isFieldActive(nextType, field))) {
          next[field] = message;
        }
      }
      if (attempted) {
        const fresh = validate(nextType, nextValues);
        for (const field of changedFields) {
          if (fresh[field]) next[field] = fresh[field];
        }
      }
      return next;
    });
  };

  const setField = (field, value) => {
    const nextValues = { ...values, [field]: value };
    const changed = [field];
    if (field === 'preferred_date') changed.push('preferred_time');
    setValues(nextValues);
    refreshErrors(type, nextValues, changed);
  };

  const handleInput = (e) => setField(e.target.name, e.target.value);

  const handleTypeChange = (nextType) => {
    setType(nextType);
    refreshErrors(nextType, values, [...TYPE_FIELDS.appointment, ...TYPE_FIELDS.revision, 'type']);
  };

  const focusField = (field) => {
    const element = document.getElementById(fieldId(field));
    if (element) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const showErrors = (nextErrors) => {
    setErrors(nextErrors);
    const first = FIELD_ORDER.find((field) => nextErrors[field]);
    const count = Object.keys(nextErrors).length;
    setStatusMessage(
      count === 1 ? 'Please fix the highlighted field.' : `Please fix the ${count} highlighted fields.`
    );
    if (first) focusField(first);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (sending) return;
    setAttempted(true);
    const clientErrors = validate(type, values);
    if (Object.keys(clientErrors).length) {
      showErrors(clientErrors);
      return;
    }

    setErrors({});
    setSending(true);
    setStatusMessage('Sending your request...');
    errorToast.current?.dismiss();
    try {
      const { data } = await axios.post(`${API_BASE}/requests`, buildPayload(type, values, timeZone), {
        timeout: 20000,
      });
      setResult({ id: data?.id, type, email: values.email.trim(), name: values.name.trim() });
      setStatusMessage('Request received.');
    } catch (error) {
      const status = error.response?.status;
      const serverErrors = status === 422 ? fieldErrorsFromResponse(error.response.data) : null;
      if (serverErrors) {
        const mapped = {};
        for (const [field, message] of Object.entries(serverErrors)) {
          const key = isFieldActive(type, field) ? field : '_form';
          if (!mapped[key]) mapped[key] = message;
        }
        showErrors(mapped);
      } else {
        const detail = typeof error.response?.data?.detail === 'string' ? error.response.data.detail : '';
        setStatusMessage('Your request was not sent.');
        errorToast.current = toast({
          variant: 'destructive',
          title: status === 429 ? 'Too many requests' : 'Your request was not sent',
          description:
            status === 429
              ? detail || 'Too many requests. Please try again later.'
              : error.response
                ? `${detail || 'The server could not process your request.'} Please try again, or email me at ${personalInfo.email}.`
                : `Could not reach the server. Check your connection and try again, or email me at ${personalInfo.email}.`,
        });
      }
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    setValues((prev) => ({
      ...EMPTY_VALUES,
      name: prev.name,
      email: prev.email,
      contact_handle: prev.contact_handle,
    }));
    prefilledSubject.current = null;
    setErrors({});
    setAttempted(false);
    setResult(null);
    setStatusMessage('');
    requestAnimationFrame(() => document.getElementById(fieldId('subject'))?.focus());
  };

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {result ? (
        <RequestSuccess result={result} headingRef={successHeading} onReset={handleReset} />
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-busy={sending}>
          <fieldset>
            <legend id="request-type-label" className="mb-3 text-sm font-medium text-gray-400">
              What do you need?
            </legend>
            <RadioGroup
              value={type}
              onValueChange={handleTypeChange}
              aria-labelledby="request-type-label"
              aria-describedby="request-type-description"
              className="grid grid-cols-3 gap-2 sm:gap-3"
            >
              {TYPE_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <RadioGroupPrimitive.Item
                    key={option.value}
                    value={option.value}
                    className="flex h-full flex-col items-center gap-2 rounded-lg border border-gray-800 bg-[#0f0f10] px-2 py-3 text-center text-xs font-medium text-gray-400 transition-colors hover:border-gray-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 data-[state=checked]:border-cyan-400 data-[state=checked]:bg-cyan-400/10 data-[state=checked]:text-white sm:text-sm"
                  >
                    <Icon
                      size={20}
                      aria-hidden="true"
                      className={type === option.value ? 'text-cyan-400' : 'text-gray-500'}
                    />
                    {option.label}
                  </RadioGroupPrimitive.Item>
                );
              })}
            </RadioGroup>
            <p id="request-type-description" className="mt-3 text-sm text-gray-500">
              {activeOption.description}
            </p>
          </fieldset>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field name="name" label="Name" error={errors.name}>
              {(props) => (
                <Input
                  {...props}
                  name="name"
                  autoComplete="name"
                  value={values.name}
                  onChange={handleInput}
                  maxLength={LIMITS.name}
                  placeholder="Your name"
                  className={fieldClass}
                />
              )}
            </Field>
            <Field name="email" label="Email" error={errors.email}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={values.email}
                  onChange={handleInput}
                  maxLength={LIMITS.email}
                  placeholder="your.email@example.com"
                  className={fieldClass}
                />
              )}
            </Field>
            <Field name="contact_handle" label="Discord / Telegram" optional error={errors.contact_handle}>
              {(props) => (
                <Input
                  {...props}
                  name="contact_handle"
                  autoComplete="off"
                  value={values.contact_handle}
                  onChange={handleInput}
                  maxLength={LIMITS.contact_handle}
                  placeholder="@username"
                  className={fieldClass}
                />
              )}
            </Field>
            <Field name="service" label="Service" optional error={errors.service}>
              {(props) => (
                <Select
                  value={values.service || NO_SERVICE}
                  onValueChange={(value) => setField('service', value === NO_SERVICE ? '' : value)}
                >
                  <SelectTrigger {...props} className={cn(fieldClass, !values.service && 'text-gray-600')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-gray-800 bg-[#0f0f10] text-white">
                    <SelectItem value={NO_SERVICE} className="text-gray-400">
                      Not sure yet
                    </SelectItem>
                    {SERVICES.map((service) => (
                      <SelectItem key={service} value={service}>
                        {service}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          {type === 'appointment' && (
            <fieldset className="space-y-4 rounded-lg border border-gray-800 p-4 sm:p-5">
              <legend className="px-2 font-mono text-xs uppercase tracking-wider text-cyan-400">Preferred time</legend>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field name="preferred_date" label="Date" error={errors.preferred_date} className="col-span-2">
                  {({ id, ...props }) => (
                    <Popover open={dateOpen} onOpenChange={setDateOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          id={id}
                          {...props}
                          aria-labelledby={`${id}-label ${id}-value`}
                          className={cn(
                            fieldClass,
                            'flex items-center justify-between gap-2 text-left',
                            !selectedDate && 'text-gray-600'
                          )}
                        >
                          <span id={`${id}-value`} className="truncate">
                            {selectedDate
                              ? formatCalendarDate(selectedDate, { month: 'short', day: 'numeric', year: 'numeric' })
                              : 'Pick a date'}
                          </span>
                          <CalendarDays size={18} className="flex-shrink-0 text-gray-500" aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-auto border-gray-800 bg-[#0f0f10] p-0 text-white"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                      >
                        <Calendar
                          mode="single"
                          selected={selectedDate || undefined}
                          defaultMonth={selectedDate || today}
                          onSelect={(date) => {
                            if (!date) return;
                            setField('preferred_date', toISODate(date));
                            setDateOpen(false);
                          }}
                          disabled={[{ before: today }, { after: maxDate }]}
                          fromMonth={today}
                          toMonth={maxDate}
                          weekStartsOn={1}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </Field>
                <Field name="preferred_time" label="Time" error={errors.preferred_time}>
                  {(props) => (
                    <Select value={values.preferred_time} onValueChange={(value) => setField('preferred_time', value)}>
                      <SelectTrigger {...props} className={cn(fieldClass, !values.preferred_time && 'text-gray-600')}>
                        <SelectValue placeholder="--:--" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 border-gray-800 bg-[#0f0f10] text-white">
                        {TIME_SLOTS.map((slot) => (
                          <SelectItem key={slot} value={slot} disabled={isToday && slot <= nowTime}>
                            {slot}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field name="duration_minutes" label="Length" error={errors.duration_minutes}>
                  {(props) => (
                    <Select
                      value={values.duration_minutes}
                      onValueChange={(value) => setField('duration_minutes', value)}
                    >
                      <SelectTrigger {...props} className={fieldClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-gray-800 bg-[#0f0f10] text-white">
                        {DURATIONS.map((minutes) => (
                          <SelectItem key={minutes} value={String(minutes)}>
                            {minutes} min
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              </div>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
                <Globe size={14} aria-hidden="true" />
                Times are in your timezone:
                <span className="font-mono text-gray-300">{timeZone}</span>
              </p>
              {errors.timezone && (
                <p className="flex items-start gap-1.5 text-sm text-red-400">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {errors.timezone}
                </p>
              )}
            </fieldset>
          )}

          {type === 'revision' && (
            <Field
              name="project_reference"
              label="Project reference"
              hint="Project or order name from our previous work"
              error={errors.project_reference}
            >
              {(props) => (
                <Input
                  {...props}
                  name="project_reference"
                  autoComplete="off"
                  value={values.project_reference}
                  onChange={handleInput}
                  maxLength={LIMITS.project_reference}
                  placeholder="e.g. Portfolio website, Ticket bot v2"
                  className={fieldClass}
                />
              )}
            </Field>
          )}

          <Field name="subject" label="Subject" error={errors.subject}>
            {(props) => (
              <Input
                {...props}
                name="subject"
                autoComplete="off"
                value={values.subject}
                onChange={handleInput}
                maxLength={LIMITS.subject}
                placeholder={
                  type === 'appointment'
                    ? 'What would you like to talk about?'
                    : type === 'revision'
                      ? 'What needs to change?'
                      : "What's this about?"
                }
                className={fieldClass}
              />
            )}
          </Field>

          <Field name="message" label="Message" error={errors.message}>
            {(props) => (
              <>
                <Textarea
                  {...props}
                  name="message"
                  value={values.message}
                  onChange={handleInput}
                  maxLength={LIMITS.message}
                  rows={6}
                  placeholder={
                    type === 'revision'
                      ? 'Describe the changes you need. Links and page names help.'
                      : 'Tell me about your project...'
                  }
                  className={cn(fieldClass, 'h-auto min-h-[150px] resize-y py-3')}
                />
                <p className="mt-1 text-right font-mono text-xs text-gray-600" aria-hidden="true">
                  {charCount(values.message)} / {LIMITS.message}
                </p>
              </>
            )}
          </Field>

          <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
            <label htmlFor={fieldId('website')}>Website</label>
            <input
              type="text"
              id={fieldId('website')}
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={values.website}
              onChange={(e) => setValues((prev) => ({ ...prev, website: e.target.value }))}
            />
          </div>

          {errors._form && (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              {errors._form}
            </p>
          )}

          <div>
            <button
              type="submit"
              disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-6 py-4 font-semibold text-black transition-all duration-300 hover:bg-cyan-300 hover:shadow-lg hover:shadow-cyan-400/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:shadow-none"
            >
              {sending ? (
                <>
                  <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                  Sending...
                </>
              ) : (
                <>
                  <Send size={20} aria-hidden="true" />
                  {activeOption.submit}
                </>
              )}
            </button>
            <p className="mt-3 text-center text-xs text-gray-600">
              Your details are only used to reply to this request.
            </p>
          </div>
        </form>
      )}
    </>
  );
};

export default RequestForm;
