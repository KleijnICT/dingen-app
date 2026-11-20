-- Sync protocol 4 (plan 33): the step-by-step review of before plan 29 is no entity type any more.
DELETE FROM `entities` WHERE `entity_type` = 'review';--> statement-breakpoint
DELETE FROM `changes` WHERE `entity_type` = 'review';
