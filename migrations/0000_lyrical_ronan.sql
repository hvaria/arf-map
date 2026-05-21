CREATE TABLE "applicant_interests" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_seeker_id" integer NOT NULL,
	"facility_number" text NOT NULL,
	"job_id" integer,
	"role_interest" text,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"number" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"facility_type" text DEFAULT '' NOT NULL,
	"facility_group" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"county" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"licensee" text DEFAULT '' NOT NULL,
	"administrator" text DEFAULT '' NOT NULL,
	"capacity" integer DEFAULT 0,
	"first_license_date" text DEFAULT '',
	"closed_date" text DEFAULT '',
	"last_inspection_date" text DEFAULT '',
	"total_visits" integer DEFAULT 0,
	"total_type_b" integer DEFAULT 0,
	"citations" integer DEFAULT 0,
	"lat" double precision,
	"lng" double precision,
	"geocode_quality" text DEFAULT '',
	"updated_at" bigint NOT NULL,
	"enriched_at" bigint
);
--> statement-breakpoint
CREATE TABLE "facility_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'facility_admin' NOT NULL,
	"email" text,
	"email_verified" integer DEFAULT 0 NOT NULL,
	"verification_token" text,
	"verification_expiry" bigint,
	"created_at" bigint NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"subscription_status" text,
	"subscription_current_period_end" bigint,
	CONSTRAINT "facility_accounts_facility_number_unique" UNIQUE("facility_number"),
	CONSTRAINT "facility_accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "facility_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"phone" text,
	"description" text,
	"website" text,
	"email" text,
	"dba_name" text,
	"logo_storage_uri" text,
	"logo_mime_type" text,
	"logo_updated_at" bigint,
	"mailing_address_line1" text,
	"mailing_address_line2" text,
	"mailing_city" text,
	"mailing_state" text,
	"mailing_zip" text,
	"hours_of_operation_json" text,
	"languages_spoken_json" text,
	"care_types_offered_json" text,
	"administrator_name" text,
	"administrator_phone" text,
	"administrator_email" text,
	"administrator_license_number" text,
	"tax_id_last4" text,
	"year_established" integer,
	"accreditations_json" text,
	"facebook_url" text,
	"instagram_url" text,
	"linkedin_url" text,
	"report_header_text" text,
	"report_footer_text" text,
	"prefilled_from_ccld_at" bigint,
	"prefilled_fields" text,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "facility_overrides_facility_number_unique" UNIQUE("facility_number")
);
--> statement-breakpoint
CREATE TABLE "facility_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_account_id" integer NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"status" text,
	"current_period_start" bigint,
	"current_period_end" bigint,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"trial_end" bigint,
	"latest_invoice_url" text,
	"last_four" text,
	"card_brand" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "facility_subscriptions_facility_account_id_unique" UNIQUE("facility_account_id"),
	CONSTRAINT "facility_subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"salary" text NOT NULL,
	"description" text NOT NULL,
	"requirements" text NOT NULL,
	"posted_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_seeker_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"email_verified" integer DEFAULT 0 NOT NULL,
	"verification_token" text,
	"verification_expiry" bigint,
	"created_at" bigint NOT NULL,
	"last_login_at" bigint,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"updated_at" bigint,
	CONSTRAINT "job_seeker_accounts_username_unique" UNIQUE("username"),
	CONSTRAINT "job_seeker_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "job_seeker_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"license_number" text,
	"issuing_authority" text,
	"issued_at" text,
	"expires_at" text,
	"notes" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_seeker_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"name" text,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"profile_picture_url" text,
	"years_experience" integer,
	"job_types" text,
	"bio" text,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "job_seeker_profiles_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "job_seeker_work_experience" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"facility_number" text,
	"location" text,
	"employment_type" text,
	"start_date" text NOT NULL,
	"end_date" text,
	"description" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_admissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"resident_id" bigint,
	"lic_601_completed" integer DEFAULT 0,
	"lic_601_date" bigint,
	"lic_602a_completed" integer DEFAULT 0,
	"lic_602a_date" bigint,
	"lic_603_completed" integer DEFAULT 0,
	"lic_603_date" bigint,
	"lic_604a_completed" integer DEFAULT 0,
	"lic_604a_date" bigint,
	"lic_605a_completed" integer DEFAULT 0,
	"lic_605a_date" bigint,
	"lic_610d_completed" integer DEFAULT 0,
	"lic_610d_date" bigint,
	"admission_agreement_signed" integer DEFAULT 0,
	"admission_agreement_signed_at" bigint,
	"admission_agreement_signed_by" text,
	"physician_report_received" integer DEFAULT 0,
	"tb_test_results_received" integer DEFAULT 0,
	"move_in_date" bigint,
	"move_in_completed" integer DEFAULT 0,
	"assigned_room" text,
	"welcome_completed" integer DEFAULT 0,
	"notes" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_billing_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"resident_id" bigint NOT NULL,
	"charge_type" text NOT NULL,
	"description" text NOT NULL,
	"amount" double precision NOT NULL,
	"unit" text,
	"quantity" double precision DEFAULT 1 NOT NULL,
	"billing_period_start" bigint,
	"billing_period_end" bigint,
	"is_recurring" integer DEFAULT 0,
	"recurrence_interval" text,
	"prorated" integer DEFAULT 0,
	"prorate_from" bigint,
	"prorate_to" bigint,
	"source" text DEFAULT 'manual' NOT NULL,
	"clinical_ref_id" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_care_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"resident_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"created_by" text NOT NULL,
	"effective_date" bigint NOT NULL,
	"review_date" bigint NOT NULL,
	"goal" text NOT NULL,
	"intervention" text NOT NULL,
	"frequency" text NOT NULL,
	"responsible_staff" text,
	"digital_signature_resident" text,
	"digital_signature_family" text,
	"signature_date" bigint,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_compliance_calendar" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"item_type" text NOT NULL,
	"description" text NOT NULL,
	"due_date" bigint NOT NULL,
	"completed_date" bigint,
	"assigned_to" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reminder_days_before" integer DEFAULT 30,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_controlled_sub_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"medication_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"count_date" bigint NOT NULL,
	"shift" text NOT NULL,
	"counted_by" text NOT NULL,
	"witnessed_by" text NOT NULL,
	"opening_count" integer NOT NULL,
	"closing_count" integer NOT NULL,
	"administered_count" integer DEFAULT 0 NOT NULL,
	"wasted_count" integer DEFAULT 0 NOT NULL,
	"discrepancy" integer DEFAULT 0,
	"discrepancy_notes" text,
	"resolved" integer DEFAULT 0,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_daily_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"care_plan_id" bigint NOT NULL,
	"resident_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"task_name" text NOT NULL,
	"task_type" text NOT NULL,
	"scheduled_time" text,
	"shift" text,
	"assigned_to" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" bigint,
	"completion_notes" text,
	"refused" integer DEFAULT 0,
	"refuse_reason" text,
	"task_date" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_facility_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"setting_key" text NOT NULL,
	"setting_value" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"resident_id" bigint,
	"incident_type" text NOT NULL,
	"incident_date" bigint NOT NULL,
	"incident_time" text,
	"location" text,
	"description" text NOT NULL,
	"immediate_action_taken" text,
	"injury_involved" integer DEFAULT 0,
	"injury_description" text,
	"hospitalization_required" integer DEFAULT 0,
	"hospital_name" text,
	"reported_by" text NOT NULL,
	"supervisor_notified" integer DEFAULT 0,
	"supervisor_notified_at" bigint,
	"family_notified" integer DEFAULT 0,
	"family_notified_at" bigint,
	"physician_notified" integer DEFAULT 0,
	"physician_notified_at" bigint,
	"lic_624_required" integer DEFAULT 0,
	"lic_624_submitted" integer DEFAULT 0,
	"lic_624_submitted_at" bigint,
	"soc_341_required" integer DEFAULT 0,
	"soc_341_submitted" integer DEFAULT 0,
	"soc_341_submitted_at" bigint,
	"ccld_verbal_notified" integer DEFAULT 0,
	"ccld_verbal_notified_at" bigint,
	"ccld_verbal_notified_by" text,
	"event_severity" text,
	"root_cause" text,
	"corrective_action" text,
	"follow_up_date" bigint,
	"follow_up_completed" integer DEFAULT 0,
	"status" text DEFAULT 'open' NOT NULL,
	"closure_note" text,
	"closed_at" bigint,
	"closed_by" text,
	"reopened_at" bigint,
	"reopened_by" text,
	"reopen_reason" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"resident_id" bigint NOT NULL,
	"invoice_number" text NOT NULL,
	"billing_period_start" bigint NOT NULL,
	"billing_period_end" bigint NOT NULL,
	"subtotal" double precision DEFAULT 0 NOT NULL,
	"tax" double precision DEFAULT 0 NOT NULL,
	"total" double precision DEFAULT 0 NOT NULL,
	"amount_paid" double precision DEFAULT 0 NOT NULL,
	"balance_due" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"due_date" bigint,
	"sent_at" bigint,
	"paid_at" bigint,
	"payment_method" text,
	"payment_reference" text,
	"notes" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "ops_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "ops_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text,
	"contact_email" text,
	"contact_relation" text,
	"prospect_name" text NOT NULL,
	"prospect_dob" bigint,
	"prospect_gender" text,
	"care_needs_summary" text,
	"funding_source" text,
	"desired_move_in_date" bigint,
	"referral_source" text,
	"assigned_to" text,
	"stage" text DEFAULT 'inquiry' NOT NULL,
	"lost_reason" text,
	"notes" text,
	"last_contact_date" bigint,
	"next_follow_up_date" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_med_destruction" (
	"id" serial PRIMARY KEY NOT NULL,
	"medication_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"destruction_method" text NOT NULL,
	"destroyed_by" text NOT NULL,
	"witnessed_by" text NOT NULL,
	"destruction_date" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_med_passes" (
	"id" serial PRIMARY KEY NOT NULL,
	"medication_id" bigint NOT NULL,
	"resident_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"scheduled_datetime" bigint NOT NULL,
	"administered_datetime" bigint,
	"administered_by" text,
	"witness_by" text,
	"right_resident" integer DEFAULT 0,
	"right_medication" integer DEFAULT 0,
	"right_dose" integer DEFAULT 0,
	"right_route" integer DEFAULT 0,
	"right_time" integer DEFAULT 0,
	"right_reason" integer DEFAULT 0,
	"right_documentation" integer DEFAULT 0,
	"right_to_refuse" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"refusal_reason" text,
	"hold_reason" text,
	"notes" text,
	"pre_vitals_bp" text,
	"pre_vitals_pulse" integer,
	"pre_vitals_temp" double precision,
	"pre_vitals_spo2" integer,
	"prn_reason" text,
	"prn_effectiveness_noted_at" bigint,
	"prn_effectiveness_notes" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_medications" (
	"id" serial PRIMARY KEY NOT NULL,
	"resident_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"drug_name" text NOT NULL,
	"generic_name" text,
	"dosage" text NOT NULL,
	"route" text NOT NULL,
	"frequency" text NOT NULL,
	"scheduled_times" text,
	"prescriber_name" text,
	"prescriber_npi" text,
	"rx_number" text,
	"pharmacy_name" text,
	"start_date" bigint,
	"end_date" bigint,
	"is_prn" integer DEFAULT 0,
	"prn_indication" text,
	"is_controlled" integer DEFAULT 0,
	"is_psychotropic" integer DEFAULT 0,
	"is_hazardous" integer DEFAULT 0,
	"classification" text,
	"requires_vitals_before" integer DEFAULT 0,
	"vital_type" text,
	"refill_threshold_days" integer DEFAULT 7,
	"auto_refill_request" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"discontinued_reason" text,
	"discontinued_by" text,
	"discontinued_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_note_acknowledgments" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" bigint NOT NULL,
	"acknowledger_facility_account_id" bigint NOT NULL,
	"acknowledger_staff_id" bigint,
	"acknowledged_at" bigint NOT NULL,
	"device_info" text
);
--> statement-breakpoint
CREATE TABLE "ops_note_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" bigint NOT NULL,
	"uploaded_by_account_id" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"scanned_at" bigint,
	"removed_at" bigint,
	"removed_by_account_id" bigint,
	"removed_reason" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_note_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" bigint NOT NULL,
	"actor_facility_account_id" bigint,
	"action" text NOT NULL,
	"payload_diff" text,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_note_mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" bigint NOT NULL,
	"mentioned_staff_id" bigint,
	"mentioned_role" text,
	"read_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_note_tags" (
	"note_id" bigint NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_note_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"edited_by_account_id" bigint NOT NULL,
	"edit_reason" text,
	"edited_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"parent_note_id" bigint,
	"category" text NOT NULL,
	"resident_id" bigint,
	"shift_id" bigint,
	"title" text,
	"body" text NOT NULL,
	"visibility_scope" text DEFAULT 'facility_wide' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ack_required" integer DEFAULT 0 NOT NULL,
	"ack_required_role" text,
	"follow_up_by" bigint,
	"effective_until" bigint,
	"is_quick" integer DEFAULT 0 NOT NULL,
	"author_facility_account_id" bigint NOT NULL,
	"author_staff_id" bigint,
	"author_display_name" text NOT NULL,
	"author_role" text NOT NULL,
	"edit_count" integer DEFAULT 0 NOT NULL,
	"last_edited_at" bigint,
	"last_edited_by_account_id" bigint,
	"archived_at" bigint,
	"archived_by_account_id" bigint,
	"deleted_at" bigint,
	"deleted_by_account_id" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"resident_id" bigint NOT NULL,
	"amount" double precision NOT NULL,
	"payment_date" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"reference_number" text,
	"type" text DEFAULT 'payment' NOT NULL,
	"notes" text,
	"recorded_by" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_resident_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"resident_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"assessment_type" text NOT NULL,
	"assessed_by" text NOT NULL,
	"assessed_at" bigint NOT NULL,
	"bathing" integer DEFAULT 0,
	"dressing" integer DEFAULT 0,
	"grooming" integer DEFAULT 0,
	"toileting" integer DEFAULT 0,
	"continence" integer DEFAULT 0,
	"eating" integer DEFAULT 0,
	"mobility" integer DEFAULT 0,
	"transfers" integer DEFAULT 0,
	"meal_prep" integer DEFAULT 0,
	"housekeeping" integer DEFAULT 0,
	"laundry" integer DEFAULT 0,
	"transportation" integer DEFAULT 0,
	"finances" integer DEFAULT 0,
	"communication" integer DEFAULT 0,
	"cognition_score" integer,
	"behavior_notes" text,
	"fall_risk_level" text,
	"vision" text,
	"hearing" text,
	"speech" text,
	"ambulation" text,
	"self_administer_meds" integer DEFAULT 0,
	"next_due_date" bigint,
	"lic_form_number" text,
	"raw_json" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_residents" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob" bigint,
	"gender" text,
	"ssn_last4" text,
	"admission_date" bigint,
	"discharge_date" bigint,
	"room_number" text,
	"bed_number" text,
	"primary_dx" text,
	"secondary_dx" text,
	"level_of_care" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relation" text,
	"funding_source" text,
	"regional_center_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"staff_id" bigint NOT NULL,
	"shift_date" bigint NOT NULL,
	"shift_type" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_overtime" integer DEFAULT 0,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"covered_by_id" bigint,
	"notes" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text NOT NULL,
	"hire_date" bigint,
	"termination_date" bigint,
	"license_number" text,
	"license_expiry" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_tours" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"scheduled_at" bigint NOT NULL,
	"completed_at" bigint,
	"conducted_by" text,
	"outcome" text,
	"notes" text,
	"follow_up_action" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_number" text NOT NULL,
	"tracker_slug" text NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"resident_id" bigint,
	"source_entry_id" bigint NOT NULL,
	"shift" text,
	"message" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'active' NOT NULL,
	"acknowledged_by_facility_account_id" bigint,
	"acknowledged_by_staff_id" bigint,
	"acknowledged_at" bigint,
	"acknowledged_note" text,
	"resolved_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"action" text NOT NULL,
	"actor_facility_account_id" bigint,
	"actor_staff_id" bigint,
	"facility_number" text NOT NULL,
	"before" text,
	"after" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"config_json" text NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "tracker_definitions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tracker_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"tracker_slug" text NOT NULL,
	"tracker_definition_id" bigint NOT NULL,
	"facility_number" text NOT NULL,
	"resident_id" bigint,
	"shift" text,
	"occurred_at" bigint NOT NULL,
	"reported_by_facility_account_id" bigint NOT NULL,
	"reported_by_staff_id" bigint,
	"reported_by_display_name" text NOT NULL,
	"reported_by_role" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_incident" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"deleted_by_account_id" bigint
);
--> statement-breakpoint
CREATE TABLE "tracker_entry_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" bigint NOT NULL,
	"version_number" integer NOT NULL,
	"payload_snapshot" text NOT NULL,
	"changed_by_facility_account_id" bigint NOT NULL,
	"changed_by_staff_id" bigint,
	"changed_at" bigint NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
