-- AIS-1 (P1): scanned PDFs, photos and screenshots are read by OCR inside the job. The files themselves are never
-- stored; only the transcribed, PII-stripped text is kept, as for text uploads.
ALTER TABLE studio_jobs ADD COLUMN ocr_files integer NOT NULL DEFAULT 0 CHECK(ocr_files>=0);
ALTER TABLE studio_jobs ADD COLUMN ocr_model text;
ALTER TABLE studio_jobs ADD COLUMN ocr_cost_usd numeric(10,4);
