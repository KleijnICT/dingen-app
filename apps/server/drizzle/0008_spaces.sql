CREATE TABLE `space_members` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`level` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`space_id`, `user_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `space_members_user_idx` ON `space_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `spaces_owner_idx` ON `spaces` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_personal_owner_idx` ON `spaces` (`owner_id`) WHERE kind = 'personal';--> statement-breakpoint
ALTER TABLE `changes` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `entities` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
INSERT INTO `spaces` (`id`, `kind`, `owner_id`, `created_at`) SELECT '0' || substr(upper(hex(randomblob(13))), 1, 25), 'personal', `id`, `created_at` FROM `users`;--> statement-breakpoint
INSERT INTO `space_members` (`space_id`, `user_id`, `level`, `joined_at`) SELECT `id`, `owner_id`, 'manage', `created_at` FROM `spaces`;--> statement-breakpoint
UPDATE `entities` SET `space_id` = coalesce((SELECT `id` FROM `spaces` WHERE `spaces`.`owner_id` = `entities`.`user_id` AND `spaces`.`kind` = 'personal'), '');--> statement-breakpoint
UPDATE `changes` SET `space_id` = coalesce((SELECT `id` FROM `spaces` WHERE `spaces`.`owner_id` = `changes`.`user_id` AND `spaces`.`kind` = 'personal'), '');--> statement-breakpoint
CREATE INDEX `changes_space_seq_idx` ON `changes` (`space_id`,`seq`);--> statement-breakpoint
CREATE INDEX `entities_space_type_id_idx` ON `entities` (`space_id`,`entity_type`,`id`);