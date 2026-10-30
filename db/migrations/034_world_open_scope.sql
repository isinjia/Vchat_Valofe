-- 세계관 공유 세분화: 공유(open) 시 다른 유저의 캐릭터 작성 범위
--   all = 신규 캐릭터 자유 작성, dict_person = 공용 인명사전에 있는 인물로만 작성 가능
ALTER TABLE worlds ADD COLUMN open_scope ENUM('all','dict_person') NOT NULL DEFAULT 'all' AFTER visibility;
