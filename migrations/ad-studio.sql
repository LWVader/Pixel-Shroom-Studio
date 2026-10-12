CREATE TABLE `publishing_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publishing_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
