create user ssot2026_owner;
create user ssot2026_user password 'Cambia esta urgente!';

create database ssot2026_test_db owner ssot2026_owner encoding 'UTF8' template template0;

grant connect on database ssot2026_test_db to ssot2026_user;

\c ssot2026_test_db
set role to ssot2026_owner;
create schema ssot2026;
grant usage on schema ssot2026 to ssot2026_user;

set search_path = ssot2026;

create table materias(
    cod_mat text,
    materia text,
    plan integer,
    oblgiatoria boolean,
    constraint "materias_pk" primary key (cod_mat)
);

