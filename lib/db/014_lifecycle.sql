-- TRIAL-2: one free trial per exam per device. The device id is a random first-party cookie, stored only
-- as a hash. The network address is kept as a hash too, for review only: shared networks never block a trial.
CREATE TABLE trial_devices (
 device_hash text NOT NULL,
 exam_id uuid NOT NULL REFERENCES exams(id),
 user_id uuid NOT NULL REFERENCES app_users(id),
 network_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_hash,exam_id)
);
CREATE INDEX trial_device_network ON trial_devices(network_hash,exam_id);
