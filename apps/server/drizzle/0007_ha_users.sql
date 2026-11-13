ALTER TABLE `users` ADD `ha_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_ha_user_id_unique` ON `users` (`ha_user_id`);