; Tables named by CREATE TABLE and ALTER TABLE. The whole object_reference is
; captured: its schema and name fields are split in sql-schema.ts, which also
; strips quoting.
(create_table (object_reference) @create.table)
(alter_table (object_reference) @alter.table)
