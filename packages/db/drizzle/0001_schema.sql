CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "ling";
--> statement-breakpoint
CREATE TABLE "app"."ai_call" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"route" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"status" text NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_call_route_check" CHECK ("route" in ('tutor.analyze', 'tutor.reply', 'tutor.summary', 'reader.disambiguate', 'reader.gloss', 'reader.translate')),
	CONSTRAINT "ai_call_status_check" CHECK ("status" in ('ok', 'refused', 'truncated', 'error'))
);
--> statement-breakpoint
ALTER TABLE "app"."ai_call" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."text" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"analysis" jsonb,
	"analysis_version" smallint,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"token_count" integer,
	"unique_lemma_count" integer,
	"coverage" real,
	"coverage_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "text_source_check" CHECK ("source" in ('paste', 'library', 'generated', 'url')),
	CONSTRAINT "text_status_check" CHECK ("status" in ('processing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "app"."text" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"exercise_id" text,
	"lemma_id" integer,
	"g_case" text NOT NULL,
	"g_number" text NOT NULL,
	"g_gender" text,
	"pattern" text,
	"trigger_id" text,
	"correct" boolean NOT NULL,
	"retry" boolean DEFAULT false NOT NULL,
	"diagnosis" text,
	"error_type" text,
	"given" text,
	"expected" text,
	"given_case" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	CONSTRAINT "attempt_source_check" CHECK ("source" in ('trainer', 'lesson', 'review', 'placement', 'tutor')),
	CONSTRAINT "attempt_g_case_check" CHECK ("g_case" in ('nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins')),
	CONSTRAINT "attempt_g_number_check" CHECK ("g_number" in ('sg', 'pl')),
	CONSTRAINT "attempt_g_gender_check" CHECK ("g_gender" in ('m_anim', 'm_inan', 'f', 'n')),
	CONSTRAINT "attempt_diagnosis_check" CHECK ("diagnosis" in ('correct', 'other_case', 'diacritics', 'wrong_pattern', 'not_a_form')),
	CONSTRAINT "attempt_error_type_check" CHECK ("error_type" in ('case_after_preposition', 'case_after_verb', 'case_after_numeral', 'case_other', 'agreement_gender', 'agreement_number', 'agreement_case', 'animacy', 'genitive_plural', 'pattern_ending', 'pronoun_form', 'verb_form', 'aspect', 'word_order', 'vocabulary', 'spelling', 'other')),
	CONSTRAINT "attempt_given_case_check" CHECK ("given_case" in ('nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins'))
);
--> statement-breakpoint
ALTER TABLE "app"."attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."card" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"template" text DEFAULT 'recall' NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"due_at" timestamp with time zone,
	"new_ord" bigint,
	"stability" real,
	"difficulty" real,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_review_at" timestamp with time zone,
	"scheduler_state" jsonb,
	"scheduler_version" text,
	"variant_cursor" smallint DEFAULT 0 NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_note_template_unique" UNIQUE("note_id","template"),
	CONSTRAINT "card_template_check" CHECK ("template" in ('recall')),
	CONSTRAINT "card_state_check" CHECK ("state" in ('new', 'learning', 'review', 'relearning'))
);
--> statement-breakpoint
ALTER TABLE "app"."card" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."content_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_ref" text NOT NULL,
	"comment" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_report_target_kind_check" CHECK ("target_kind" in ('exercise', 'sense', 'sentence', 'lesson', 'tutor_error', 'analysis_token')),
	CONSTRAINT "content_report_status_check" CHECK ("status" in ('open', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "app"."content_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"goal_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"model" text,
	"prompt_version" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_mode_check" CHECK ("mode" in ('scenario', 'case_coach')),
	CONSTRAINT "conversation_status_check" CHECK ("status" in ('active', 'completed', 'abandoned'))
);
--> statement-breakpoint
ALTER TABLE "app"."conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."lesson_progress" (
	"user_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"status" text NOT NULL,
	"step_index" smallint DEFAULT 0 NOT NULL,
	"score" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_progress_pkey" PRIMARY KEY("user_id","lesson_id"),
	CONSTRAINT "lesson_progress_status_check" CHECK ("status" in ('locked', 'available', 'in_progress', 'completed', 'tested_out'))
);
--> statement-breakpoint
ALTER TABLE "app"."lesson_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"annotations" jsonb,
	"usage" jsonb,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_conversation_seq_unique" UNIQUE("conversation_id","seq"),
	CONSTRAINT "message_conversation_client_unique" UNIQUE("conversation_id","client_id"),
	CONSTRAINT "message_role_check" CHECK ("role" in ('tutor', 'learner', 'system_note'))
);
--> statement-breakpoint
ALTER TABLE "app"."message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lemma_id" integer,
	"exercise_id" text,
	"text_id" uuid,
	"content" jsonb NOT NULL,
	"source" text NOT NULL,
	"source_ref" jsonb,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "note_kind_check" CHECK ("kind" in ('word', 'phrase', 'case_sentence')),
	CONSTRAINT "note_source_check" CHECK ("source" in ('reader', 'words', 'declension', 'tutor', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "app"."note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."placement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "placement_status_check" CHECK ("status" in ('active', 'completed', 'abandoned'))
);
--> statement-breakpoint
ALTER TABLE "app"."placement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"ui_lang" text DEFAULT 'en' NOT NULL,
	"explain_lang" text DEFAULT 'en' NOT NULL,
	"level" text DEFAULT 'A2' NOT NULL,
	"timezone" text DEFAULT 'Europe/Bratislava' NOT NULL,
	"day_start_hour" smallint DEFAULT 4 NOT NULL,
	"daily_new_limit" smallint DEFAULT 10 NOT NULL,
	"daily_review_limit" smallint DEFAULT 80 NOT NULL,
	"desired_retention" real DEFAULT 0.9 NOT NULL,
	"strict_diacritics" boolean DEFAULT false NOT NULL,
	"placement_done_at" timestamp with time zone,
	"current_lesson_id" text,
	"words_band_target" integer DEFAULT 1000 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_level_check" CHECK ("level" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'))
);
--> statement-breakpoint
ALTER TABLE "app"."profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rating" smallint NOT NULL,
	"grade" text NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"typed" text,
	"expected" text,
	"variant" smallint,
	"duration_ms" integer,
	"state_before" jsonb,
	"state_after" jsonb,
	"client_id" text,
	"diagnosis" jsonb,
	CONSTRAINT "review_rating_check" CHECK ("rating" in (1, 2, 3, 4)),
	CONSTRAINT "review_grade_check" CHECK ("grade" in ('correct', 'close', 'wrong', 'revealed'))
);
--> statement-breakpoint
ALTER TABLE "app"."review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."tutor_error" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"given" text NOT NULL,
	"expected" text NOT NULL,
	"corrected_sentence" text,
	"error_type" text NOT NULL,
	"case_expected" text,
	"case_given" text,
	"lemma_id" integer,
	"trigger_id" text,
	"explanation_en" text,
	"severity" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"note_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tutor_error_error_type_check" CHECK ("error_type" in ('case_after_preposition', 'case_after_verb', 'case_after_numeral', 'case_other', 'agreement_gender', 'agreement_number', 'agreement_case', 'animacy', 'genitive_plural', 'pattern_ending', 'pronoun_form', 'verb_form', 'aspect', 'word_order', 'vocabulary', 'spelling', 'other')),
	CONSTRAINT "tutor_error_case_expected_check" CHECK ("case_expected" in ('nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins')),
	CONSTRAINT "tutor_error_case_given_check" CHECK ("case_given" in ('nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins')),
	CONSTRAINT "tutor_error_severity_check" CHECK ("severity" in ('case', 'other')),
	CONSTRAINT "tutor_error_status_check" CHECK ("status" in ('prompted', 'self_corrected', 'corrected', 'summary_only', 'disputed'))
);
--> statement-breakpoint
ALTER TABLE "app"."tutor_error" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."user_lemma" (
	"user_id" uuid NOT NULL,
	"lemma_id" integer NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"known_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_lemma_pkey" PRIMARY KEY("user_id","lemma_id"),
	CONSTRAINT "user_lemma_status_check" CHECK ("status" in ('unknown', 'learning', 'known', 'ignored')),
	CONSTRAINT "user_lemma_source_check" CHECK ("source" in ('placement', 'triage', 'reader', 'review', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "app"."user_lemma" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ling"."content_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ling"."content_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"version" text NOT NULL,
	"built_at" timestamp with time zone NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sources" jsonb NOT NULL,
	"counts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ling"."exercise" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"sentence_sk" text NOT NULL,
	"sentence_en" text NOT NULL,
	"target" jsonb NOT NULL,
	"g_case" text NOT NULL,
	"g_number" text NOT NULL,
	"g_gender" text NOT NULL,
	"pattern" text,
	"trigger_id" text,
	"options" jsonb,
	"lesson_id" text,
	"difficulty" real NOT NULL,
	"source" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "exercise_kind_check" CHECK ("kind" in ('cloze', 'choice_meaning', 'choice_form')),
	CONSTRAINT "exercise_g_case_check" CHECK ("g_case" in ('nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins')),
	CONSTRAINT "exercise_g_number_check" CHECK ("g_number" in ('sg', 'pl')),
	CONSTRAINT "exercise_g_gender_check" CHECK ("g_gender" in ('m_anim', 'm_inan', 'f', 'n')),
	CONSTRAINT "exercise_source_check" CHECK ("source" in ('authored', 'generated', 'ud', 'tatoeba'))
);
--> statement-breakpoint
CREATE TABLE "ling"."form" (
	"lemma_id" integer NOT NULL,
	"form" text NOT NULL,
	"form_ascii" text NOT NULL,
	"tags" text NOT NULL,
	CONSTRAINT "form_pkey" PRIMARY KEY("lemma_id","form")
);
--> statement-breakpoint
CREATE TABLE "ling"."lemma" (
	"id" integer PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"lemma" text NOT NULL,
	"lemma_ascii" text NOT NULL,
	"pos" text NOT NULL,
	"gender" text,
	"pattern" text,
	"aspect" text,
	"freq_rank" integer,
	"top_forms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "lemma_key_unique" UNIQUE("key"),
	CONSTRAINT "lemma_pos_check" CHECK ("pos" in ('noun', 'adj', 'pron', 'num', 'verb', 'adv', 'prep', 'conj', 'part', 'intj', 'other')),
	CONSTRAINT "lemma_gender_check" CHECK ("gender" in ('m_anim', 'm_inan', 'f', 'n')),
	CONSTRAINT "lemma_aspect_check" CHECK ("aspect" in ('ipf', 'pf', 'both'))
);
--> statement-breakpoint
CREATE TABLE "ling"."lemma_sentence" (
	"lemma_id" integer NOT NULL,
	"sentence_id" text NOT NULL,
	"token_index" smallint NOT NULL,
	"form" text NOT NULL,
	"tag" text NOT NULL,
	"ord" smallint NOT NULL,
	CONSTRAINT "lemma_sentence_pkey" PRIMARY KEY("lemma_id","sentence_id","token_index")
);
--> statement-breakpoint
CREATE TABLE "ling"."lesson" (
	"id" text PRIMARY KEY NOT NULL,
	"course" text DEFAULT 'declension' NOT NULL,
	"ord" smallint NOT NULL,
	"title_en" text NOT NULL,
	"title_sk" text NOT NULL,
	"g_case" text,
	"g_number" text,
	"focus" jsonb NOT NULL,
	"summary_md" text NOT NULL,
	"prerequisites" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "lesson_g_case_check" CHECK ("g_case" in ('nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins')),
	CONSTRAINT "lesson_g_number_check" CHECK ("g_number" in ('sg', 'pl'))
);
--> statement-breakpoint
CREATE TABLE "ling"."lesson_step" (
	"lesson_id" text NOT NULL,
	"ord" smallint NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "lesson_step_pkey" PRIMARY KEY("lesson_id","ord"),
	CONSTRAINT "lesson_step_kind_check" CHECK ("kind" in ('explain', 'triggers', 'comprehension', 'production', 'checkpoint'))
);
--> statement-breakpoint
CREATE TABLE "ling"."library_text" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"level" text NOT NULL,
	"analysis" jsonb,
	"lemma_counts" jsonb,
	"source" text NOT NULL,
	"license" text NOT NULL,
	"ord" smallint NOT NULL,
	CONSTRAINT "library_text_level_check" CHECK ("level" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "library_text_source_check" CHECK ("source" in ('authored', 'generated', 'public_domain'))
);
--> statement-breakpoint
CREATE TABLE "ling"."pattern" (
	"id" text PRIMARY KEY NOT NULL,
	"label_sk" text NOT NULL,
	"pos" text NOT NULL,
	"gender" text,
	"model_lemma_id" integer,
	"everyday_model_lemma_id" integer,
	"endings" jsonb NOT NULL,
	"notes_en" text,
	CONSTRAINT "pattern_pos_check" CHECK ("pos" in ('noun', 'adj')),
	CONSTRAINT "pattern_gender_check" CHECK ("gender" in ('m_anim', 'm_inan', 'f', 'n'))
);
--> statement-breakpoint
CREATE TABLE "ling"."scenario" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"title_en" text NOT NULL,
	"title_sk" text NOT NULL,
	"goal_en" text NOT NULL,
	"setting_sk" text NOT NULL,
	"tutor_role" text NOT NULL,
	"target_cases" text[] NOT NULL,
	"target_triggers" text[] NOT NULL,
	"level" text NOT NULL,
	"opening_sk" text NOT NULL,
	"success_criteria" jsonb NOT NULL,
	"vocab_hint" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ord" smallint NOT NULL,
	CONSTRAINT "scenario_mode_check" CHECK ("mode" in ('scenario', 'case_coach')),
	CONSTRAINT "scenario_level_check" CHECK ("level" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "scenario_target_cases_check" CHECK ("target_cases" <@ array['nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins']::text[])
);
--> statement-breakpoint
CREATE TABLE "ling"."sense" (
	"lemma_id" integer NOT NULL,
	"ord" smallint NOT NULL,
	"gloss_en" text NOT NULL,
	"note" text,
	"source" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sense_pkey" PRIMARY KEY("lemma_id","ord"),
	CONSTRAINT "sense_source_check" CHECK ("source" in ('wiktionary', 'generated', 'manual', 'runtime'))
);
--> statement-breakpoint
CREATE TABLE "ling"."sentence" (
	"id" text PRIMARY KEY NOT NULL,
	"text_sk" text NOT NULL,
	"text_en" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"difficulty" real NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"license" text NOT NULL,
	"audio_path" text,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sentence_source_check" CHECK ("source" in ('tatoeba', 'ud', 'generated'))
);
--> statement-breakpoint
CREATE TABLE "ling"."trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lemma" text NOT NULL,
	"lemma_id" integer,
	"g_case" text NOT NULL,
	"meaning_en" text NOT NULL,
	"note_en" text,
	"example_sk" text NOT NULL,
	"example_en" text NOT NULL,
	"contrast_group" text,
	"freq_rank" integer,
	CONSTRAINT "trigger_kind_check" CHECK ("kind" in ('preposition', 'verb', 'numeral', 'quantifier', 'question', 'adjective', 'noun', 'function')),
	CONSTRAINT "trigger_g_case_check" CHECK ("g_case" in ('nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins'))
);
--> statement-breakpoint
ALTER TABLE "app"."ai_call" ADD CONSTRAINT "ai_call_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."text" ADD CONSTRAINT "text_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."attempt" ADD CONSTRAINT "attempt_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card" ADD CONSTRAINT "card_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card" ADD CONSTRAINT "card_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "app"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."content_report" ADD CONSTRAINT "content_report_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversation" ADD CONSTRAINT "conversation_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message" ADD CONSTRAINT "message_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."note" ADD CONSTRAINT "note_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."placement" ADD CONSTRAINT "placement_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review" ADD CONSTRAINT "review_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review" ADD CONSTRAINT "review_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "app"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_error" ADD CONSTRAINT "tutor_error_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_error" ADD CONSTRAINT "tutor_error_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_error" ADD CONSTRAINT "tutor_error_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_error" ADD CONSTRAINT "tutor_error_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "app"."note"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_lemma" ADD CONSTRAINT "user_lemma_user_id_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profile"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ling"."form" ADD CONSTRAINT "form_lemma_id_lemma_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "ling"."lemma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ling"."lemma_sentence" ADD CONSTRAINT "lemma_sentence_lemma_id_lemma_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "ling"."lemma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ling"."lemma_sentence" ADD CONSTRAINT "lemma_sentence_sentence_id_sentence_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "ling"."sentence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ling"."lesson_step" ADD CONSTRAINT "lesson_step_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "ling"."lesson"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ling"."sense" ADD CONSTRAINT "sense_lemma_id_lemma_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "ling"."lemma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_user_created_idx" ON "app"."ai_call" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "text_user_archived_opened_idx" ON "app"."text" USING btree ("user_id","archived","last_opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attempt_user_bucket_idx" ON "app"."attempt" USING btree ("user_id","g_case","g_number","g_gender","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "card_user_state_due_idx" ON "app"."card" USING btree ("user_id","state","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "note_user_word_idx" ON "app"."note" USING btree ("user_id","lemma_id") WHERE "kind" = 'word' and "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "note_user_exercise_idx" ON "app"."note" USING btree ("user_id","exercise_id") WHERE "exercise_id" is not null and "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "note_user_created_idx" ON "app"."note" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "review_user_answered_idx" ON "app"."review" USING btree ("user_id","answered_at");--> statement-breakpoint
CREATE INDEX "review_card_answered_idx" ON "app"."review" USING btree ("card_id","answered_at");--> statement-breakpoint
CREATE INDEX "exercise_bucket_idx" ON "ling"."exercise" USING btree ("g_case","g_number","g_gender");--> statement-breakpoint
CREATE INDEX "exercise_lesson_id_idx" ON "ling"."exercise" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "form_form_ascii_idx" ON "ling"."form" USING btree ("form_ascii");--> statement-breakpoint
CREATE INDEX "lemma_lemma_ascii_idx" ON "ling"."lemma" USING btree ("lemma_ascii");--> statement-breakpoint
CREATE INDEX "lemma_freq_rank_idx" ON "ling"."lemma" USING btree ("freq_rank") WHERE "freq_rank" is not null;--> statement-breakpoint
CREATE POLICY "ai_call_select_own" ON "app"."ai_call" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "ai_call_insert_own" ON "app"."ai_call" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "ai_call_delete_own" ON "app"."ai_call" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "text_select_own" ON "app"."text" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "text_insert_own" ON "app"."text" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "text_delete_own" ON "app"."text" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "text_update_own" ON "app"."text" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "attempt_select_own" ON "app"."attempt" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "attempt_insert_own" ON "app"."attempt" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "attempt_delete_own" ON "app"."attempt" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "card_select_own" ON "app"."card" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "card_insert_own" ON "app"."card" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "card_delete_own" ON "app"."card" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "card_update_own" ON "app"."card" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "content_report_select_own" ON "app"."content_report" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "content_report_insert_own" ON "app"."content_report" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "content_report_delete_own" ON "app"."content_report" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "content_report_update_own" ON "app"."content_report" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "conversation_select_own" ON "app"."conversation" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "conversation_insert_own" ON "app"."conversation" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "conversation_delete_own" ON "app"."conversation" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "conversation_update_own" ON "app"."conversation" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "lesson_progress_select_own" ON "app"."lesson_progress" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "lesson_progress_insert_own" ON "app"."lesson_progress" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "lesson_progress_delete_own" ON "app"."lesson_progress" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "lesson_progress_update_own" ON "app"."lesson_progress" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "message_select_own" ON "app"."message" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "message_insert_own" ON "app"."message" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "message_delete_own" ON "app"."message" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "message_update_own" ON "app"."message" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "note_select_own" ON "app"."note" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "note_insert_own" ON "app"."note" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "note_delete_own" ON "app"."note" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "note_update_own" ON "app"."note" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "placement_select_own" ON "app"."placement" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "placement_insert_own" ON "app"."placement" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "placement_delete_own" ON "app"."placement" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "placement_update_own" ON "app"."placement" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profile_select_own" ON "app"."profile" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profile_insert_own" ON "app"."profile" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profile_delete_own" ON "app"."profile" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profile_update_own" ON "app"."profile" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "review_select_own" ON "app"."review" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "review_insert_own" ON "app"."review" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "review_delete_own" ON "app"."review" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "tutor_error_select_own" ON "app"."tutor_error" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "tutor_error_insert_own" ON "app"."tutor_error" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "tutor_error_delete_own" ON "app"."tutor_error" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "tutor_error_update_own" ON "app"."tutor_error" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_lemma_select_own" ON "app"."user_lemma" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_lemma_insert_own" ON "app"."user_lemma" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_lemma_delete_own" ON "app"."user_lemma" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_lemma_update_own" ON "app"."user_lemma" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_id" = (select auth.uid())) WITH CHECK ("user_id" = (select auth.uid()));