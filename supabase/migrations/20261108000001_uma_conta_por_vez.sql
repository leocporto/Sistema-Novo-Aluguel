-- Uma conta (imobiliária) por vez.
--
-- Antes, privado.org_ids() devolvia TODAS as imobiliárias de que o usuário é
-- membro. Quem estava em duas (ex.: convidado para a equipe de outra e também
-- dono da própria) via os dados das duas misturados nas listas, enquanto a
-- tela achava que estava só na primeira. Agora o banco libera só a conta atual
-- (a mesma que o sistema abre: privado.org_atual(), a primeira em que a pessoa
-- entrou). Como todas as políticas de segurança (tabelas e arquivos) passam por
-- org_ids(), nenhum dado de outra conta aparece, nem pela API.
create or replace function privado.org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o from (select privado.org_atual() as o) x where o is not null
$$;
