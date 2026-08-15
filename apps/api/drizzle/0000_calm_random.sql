CREATE TYPE "public"."automation_status" AS ENUM('draft', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('queued', 'running', 'success', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('trigger', 'action', 'ai_provider');--> statement-breakpoint
CREATE TYPE "public"."on_error_behavior" AS ENUM('stop', 'continue');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'success', 'error', 'skipped');--> statement-breakpoint
CREATE TABLE "automation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action_type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_id" uuid,
	"on_error" "on_error_behavior" DEFAULT 'stop' NOT NULL,
	"retries" integer DEFAULT 2 NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "automation_status" DEFAULT 'draft' NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_token" text NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" "execution_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"integration_id" text NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"data_encrypted" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"automation_action_id" uuid,
	"position" integer NOT NULL,
	"action_type" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" jsonb,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"trigger_payload" jsonb,
	"result" jsonb,
	"error" jsonb,
	"is_manual" boolean DEFAULT false NOT NULL,
	"queue_job_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"tokens_valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "automation_actions" ADD CONSTRAINT "automation_actions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_actions" ADD CONSTRAINT "automation_actions_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_steps" ADD CONSTRAINT "execution_steps_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_actions_automation_idx" ON "automation_actions" USING btree ("automation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "automations_webhook_token_idx" ON "automations" USING btree ("webhook_token");--> statement-breakpoint
CREATE INDEX "automations_status_idx" ON "automations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automations_trigger_type_idx" ON "automations" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX "credentials_integration_idx" ON "credentials" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "execution_steps_execution_idx" ON "execution_steps" USING btree ("execution_id","position");--> statement-breakpoint
CREATE INDEX "executions_automation_created_idx" ON "executions" USING btree ("automation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "executions_created_idx" ON "executions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");