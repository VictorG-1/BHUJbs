do $$
begin
  alter type registration_type add value if not exists 'general_room';
exception
  when duplicate_object then null;
end $$;
