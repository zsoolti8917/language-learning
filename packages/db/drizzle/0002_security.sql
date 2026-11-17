-- Grants and forced row level security (docs/contracts.md, rules of both schemas).

-- Schema ling: read only for learners; the API reads it and stores run time glosses.
GRANT USAGE ON SCHEMA ling TO authenticated, app_api;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA ling TO authenticated, app_api;
--> statement-breakpoint
GRANT INSERT, UPDATE ON ling.sense TO app_api;
--> statement-breakpoint

-- Schema app: only `authenticated` holds rights, and the policies limit them to the
-- learner's own rows. `app_api` gets nothing here; it reaches learner rows only after
-- `set local role authenticated`.
GRANT USAGE ON SCHEMA app TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.profile, app.user_lemma, app.note, app.card, app.lesson_progress, app.text,
  app.conversation, app.message, app.tutor_error, app.placement, app.content_report
  TO authenticated;
--> statement-breakpoint
-- Append only tables: no update.
GRANT SELECT, INSERT, DELETE ON app.review, app.attempt, app.ai_call TO authenticated;
--> statement-breakpoint

-- Forced row level security: the policies hold even for the tables' owner.
ALTER TABLE app.profile FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.user_lemma FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.note FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.card FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.review FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.attempt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.lesson_progress FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.text FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.conversation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.message FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tutor_error FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.placement FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ai_call FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.content_report FORCE ROW LEVEL SECURITY;
