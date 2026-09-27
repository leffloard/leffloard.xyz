import "server-only";
import { ObjectId, type Db } from "mongodb";
import { now } from "@/server/clock";
import type { PublicUser, UserDoc } from "@/server/auth/types";
import { hashPassword } from "@/server/security/password";

export function users(db: Db) {
  return db.collection<UserDoc>("users");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    hasTotp: user.totp !== null,
    recoveryCodesLeft: user.recoveryCodes.filter((code) => code.usedAt === null).length,
    passwordChangedAt: user.passwordChangedAt,
  };
}

export async function findUserByEmail(db: Db, email: string): Promise<UserDoc | null> {
  return users(db).findOne({ email: normalizeEmail(email) });
}

export async function findUserById(db: Db, id: ObjectId): Promise<UserDoc | null> {
  return users(db).findOne({ _id: id });
}

export async function findOwner(db: Db): Promise<UserDoc | null> {
  return users(db).findOne({ role: "owner" });
}

export class OwnerExistsError extends Error {
  constructor() {
    super("An owner account already exists. Use reset-password or reset-2fa instead.");
    this.name = "OwnerExistsError";
  }
}

// The single owner account. Two-step sign-in is set up on the first sign-in.
export async function createOwner(
  db: Db,
  { email, name, password }: { email: string; name: string; password: string },
): Promise<UserDoc> {
  if (await findOwner(db)) throw new OwnerExistsError();
  const at = now();
  const user: UserDoc = {
    _id: new ObjectId(),
    email: normalizeEmail(email),
    name: name.trim(),
    role: "owner",
    passwordHash: await hashPassword(password),
    passwordChangedAt: at,
    totp: null,
    recoveryCodes: [],
    createdAt: at,
    updatedAt: at,
  };
  await users(db).insertOne(user);
  return user;
}

export async function setPassword(db: Db, userId: ObjectId, password: string): Promise<void> {
  const at = now();
  await users(db).updateOne(
    { _id: userId },
    { $set: { passwordHash: await hashPassword(password), passwordChangedAt: at, updatedAt: at } },
  );
}
