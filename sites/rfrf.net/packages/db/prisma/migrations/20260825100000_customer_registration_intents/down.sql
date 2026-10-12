-- Pending intents contain no accepted customer identity and may be discarded
-- during a rehearsed rollback. Existing User rows are untouched.
DROP TABLE "customer_registration_intents";
