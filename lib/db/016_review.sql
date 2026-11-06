-- STU-13: practice sessions can draw from the spaced-repetition review deck.
ALTER TABLE practice_attempts DROP CONSTRAINT practice_attempts_pool_check;
ALTER TABLE practice_attempts ADD CONSTRAINT practice_attempts_pool_check CHECK(pool IN ('all','unanswered','mistakes','paper','review'));
