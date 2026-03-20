ALTER TABLE public.schedule_config ADD COLUMN IF NOT EXISTS folder_path text NOT NULL DEFAULT '';
ALTER TABLE public.schedule_config ADD COLUMN IF NOT EXISTS end_at timestamptz DEFAULT NULL;