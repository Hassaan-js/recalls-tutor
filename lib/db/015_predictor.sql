-- PP-3: after the exam, students can tell us whether they passed. Once about 200 outcomes exist per exam,
-- the predictor is compared with real results. The band shown at the time is kept with each answer.
CREATE TABLE pass_outcomes (
 user_id uuid NOT NULL REFERENCES app_users(id),
 exam_id uuid NOT NULL REFERENCES exams(id),
 sat_on date,
 passed boolean,
 band text CHECK(band IN ('low','borderline','likely','very_likely')),
 predicted_low numeric(5,2),
 predicted_high numeric(5,2),
 answered_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,exam_id)
);
