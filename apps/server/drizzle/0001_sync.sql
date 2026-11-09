CREATE TABLE `changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`client_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`fields` text NOT NULL,
	`ts` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changes_user_change_idx` ON `changes` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `changes_user_seq_idx` ON `changes` (`user_id`,`seq`);--> statement-breakpoint
CREATE TABLE `entities` (
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`field_ts` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_seq` integer NOT NULL,
	PRIMARY KEY(`user_id`, `entity_type`, `id`)
);
