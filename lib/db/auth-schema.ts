import { pgTable, text, timestamp, boolean, integer, bigint } from 'drizzle-orm/pg-core';

export const user = pgTable('auth_users', {
 id:text('id').primaryKey(), name:text('name').notNull(), email:text('email').notNull().unique(),
 emailVerified:boolean('email_verified').notNull().default(false), image:text('image'),
 twoFactorEnabled:boolean('two_factor_enabled').notNull().default(false),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull(), updatedAt:timestamp('updated_at',{withTimezone:true}).notNull(),
});
export const session = pgTable('auth_sessions', {
 id:text('id').primaryKey(), token:text('token').notNull().unique(),
 userId:text('user_id').notNull().references(()=>user.id,{onDelete:'cascade'}),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull(), updatedAt:timestamp('updated_at',{withTimezone:true}).notNull(),
 ipAddress:text('ip_address'), userAgent:text('user_agent'),
});
export const account = pgTable('auth_accounts', {
 id:text('id').primaryKey(), accountId:text('account_id').notNull(), providerId:text('provider_id').notNull(),
 userId:text('user_id').notNull().references(()=>user.id,{onDelete:'cascade'}),
 accessToken:text('access_token'), refreshToken:text('refresh_token'), idToken:text('id_token'),
 accessTokenExpiresAt:timestamp('access_token_expires_at',{withTimezone:true}), refreshTokenExpiresAt:timestamp('refresh_token_expires_at',{withTimezone:true}),
 scope:text('scope'), password:text('password'),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull(), updatedAt:timestamp('updated_at',{withTimezone:true}).notNull(),
});
export const verification = pgTable('auth_verifications', {
 id:text('id').primaryKey(), identifier:text('identifier').notNull(), value:text('value').notNull(),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull(), updatedAt:timestamp('updated_at',{withTimezone:true}).notNull(),
});
export const twoFactor = pgTable('auth_two_factors', {
 id:text('id').primaryKey(), userId:text('user_id').notNull().unique().references(()=>user.id,{onDelete:'cascade'}),
 secret:text('secret').notNull(), backupCodes:text('backup_codes').notNull(),
 verified:boolean('verified').default(true), failedVerificationCount:integer('failed_verification_count').default(0),
 lockedUntil:timestamp('locked_until',{withTimezone:true}),
});
export const rateLimit = pgTable('auth_rate_limits', {
 id:text('id').primaryKey(), key:text('key').notNull().unique(), count:integer('count').notNull(),
 lastRequest:bigint('last_request',{mode:'number'}).notNull(),
});
