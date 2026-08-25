CREATE TABLE `marketSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`compositeScore` int NOT NULL,
	`regime` varchar(16) NOT NULL,
	`confidence` int NOT NULL,
	`dataStatus` varchar(16) NOT NULL,
	`payload` text NOT NULL,
	`calculatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketSnapshots_id` PRIMARY KEY(`id`)
);
