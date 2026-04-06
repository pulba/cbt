CREATE TABLE `admins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`level` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);--> statement-breakpoint
CREATE TABLE `configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `configs_key_unique` ON `configs` (`key`);--> statement-breakpoint
CREATE TABLE `essay_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`correct_answer` text,
	`keywords` text DEFAULT '[]',
	`grading_mode` text DEFAULT 'manual',
	`max_score` real DEFAULT 100,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `essay_configs_question_id_unique` ON `essay_configs` (`question_id`);--> statement-breakpoint
CREATE TABLE `question_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer DEFAULT false,
	`match_right` text,
	`weight` real DEFAULT 1,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer,
	`type` integer NOT NULL,
	`text` text NOT NULL,
	`audio` text,
	`audio_play_limit` integer DEFAULT 0,
	`difficulty` integer DEFAULT 1,
	`is_active` integer DEFAULT true,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_question_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_question_id` integer NOT NULL,
	`answer_id` integer NOT NULL,
	`order_idx` integer NOT NULL,
	`is_selected` integer DEFAULT false,
	FOREIGN KEY (`test_question_id`) REFERENCES `test_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answer_id`) REFERENCES `question_answers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_user_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`order_idx` integer NOT NULL,
	`score` real DEFAULT 0,
	`answer_text` text,
	`is_answered` integer DEFAULT false,
	`is_doubtful` integer DEFAULT false,
	`audio_play_count` integer DEFAULT 0,
	`essay_score_override` real,
	`essay_graded_by` integer,
	`essay_graded_at` integer,
	`essay_notes` text,
	FOREIGN KEY (`test_user_id`) REFERENCES `test_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` integer NOT NULL,
	`token` text NOT NULL,
	`lifetime_minutes` integer DEFAULT 15 NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_tokens_token_unique` ON `test_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `test_topic_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` integer NOT NULL,
	`topic_id` integer NOT NULL,
	`question_type` integer NOT NULL,
	`question_count` integer NOT NULL,
	`difficulty` integer DEFAULT 0,
	`shuffle_questions` integer DEFAULT true,
	`shuffle_answers` integer DEFAULT true,
	`answer_count` integer DEFAULT 5,
	`begin_time` integer,
	`end_time` integer,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` integer,
	`user_id` integer,
	`status` integer DEFAULT 1,
	`creation_time` integer,
	`used_token` text,
	`violation_count` integer DEFAULT 0,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`detail` text,
	`score_right` real DEFAULT 1,
	`score_wrong` real DEFAULT 0,
	`score_unanswered` real DEFAULT 0,
	`max_score` real DEFAULT 0,
	`show_result` integer DEFAULT false,
	`show_detail` integer DEFAULT false,
	`is_active` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `user_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`first_name` text NOT NULL,
	`email` text,
	`detail` text,
	`is_login` integer DEFAULT false,
	FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);