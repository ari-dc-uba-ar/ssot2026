create user ssot2026_owner;
create user ssot2026_user password 'Cambia esta urgente!';

create database ssot2026_test_db owner ssot2026_owner encoding 'UTF8' template template0;

grant connect on database ssot2026_test_db to ssot2026_user;

\c ssot2026_test_db
set role to ssot2026_owner;
create schema ssot;
grant usage on schema ssot to ssot2026_user;

set search_path = ssot;

create table materias(
    cod_mat text,
    materia text,
    plan integer,
    obligatoria boolean,
    constraint "materias_pk" primary key (cod_mat)
);
grant select on ssot.materias to ssot2026_user;

insert into materias(cod_mat, materia, plan, obligatoria) values
    ('ARI', 'BASE DE DATOS', 2023, true),
    ('BD', 'BASE DE DATOS', 1993, true);
    

create table pabellones(
    pab text,
    pabellon text,
    pisos integer,
    constraint "pabellones_pk" primary key (pab)
);
grant select on ssot.pabellones to ssot2026_user;

insert into pabellones(pab, pabellon, pisos) values
    ('P0+I','Cero más infinito', 2),
    ('P1','Pabellón I', 3),
    ('P2','Pabellón II', 5);
        