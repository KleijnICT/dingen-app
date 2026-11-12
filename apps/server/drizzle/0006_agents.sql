CREATE TABLE `agent_grants` (
	`agent_id` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`level` text NOT NULL,
	PRIMARY KEY(`agent_id`, `scope`, `scope_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_user_idx` ON `agents` (`user_id`);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `agent_id` text REFERENCES agents(id);--> statement-breakpoint
CREATE INDEX `api_tokens_agent_idx` ON `api_tokens` (`agent_id`);--> statement-breakpoint
ALTER TABLE `changes` ADD `actor` text;--> statement-breakpoint
INSERT INTO `agents` (`id`, `user_id`, `name`, `icon`, `color`, `created_at`) SELECT `id`, `user_id`, `name`, 'bot', 'gray', `created_at` FROM `api_tokens`;--> statement-breakpoint
INSERT INTO `agent_grants` (`agent_id`, `scope`, `scope_id`, `level`) SELECT `id`, 'all', '', 'manage' FROM `api_tokens`;--> statement-breakpoint
UPDATE `api_tokens` SET `agent_id` = `id`;
