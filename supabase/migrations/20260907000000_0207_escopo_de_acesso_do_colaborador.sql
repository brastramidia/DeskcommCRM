-- ============================================================================
-- 0207 — O ESCOPO DE ACESSO, e por que ele NÃO é um papel novo
--
-- O produto precisa de um COLABORADOR: alguém de fora que entra para tocar
-- projetos de cliente e não pode ver o CRM — nem Inbox, nem Contatos, nem
-- Funis, nem a lista de tarefas pessoais do dono.
--
-- ─── Por que não bastou um quinto papel ─────────────────────────────────────
--
-- `fn_role_at_least` e o `ROLE_RANK` do TypeScript modelam ESCADA: quem está
-- acima vê tudo de quem está abaixo. Medido no registro de navegação: QUINZE
-- telas não exigem papel nenhum, então o degrau mais baixo que existe já
-- enxerga Inbox, Radar, Agenda, Funis, Contatos, Desempenho e Tarefas.
--
-- Um "colaborador" como degrau inferior veria exatamente o que ele não pode
-- ver. O que se quer não é um papel MENOR — é um conjunto DIFERENTE.
--
-- ─── Por que uma coluna, e não uma tabela de permissões ────────────────────
--
-- DIRC, letra D: a informação é "que porta esta pessoa usa nesta organização",
-- e ela vive exatamente onde o vínculo vive. Uma tabela de permissões por tela
-- seria a resposta para "cada cliente monta o seu perfil", que ninguém pediu —
-- e traria uma superfície de RLS nova para proteger o que uma coluna resolve.
--
-- ⚠️ E o padrão já existe neste banco: `is_platform_admin` é descrito no código
-- como "role transversal", ortogonal ao rank. Isto é a mesma ideia do lado do
-- tenant.
--
-- ─── A regra que atravessa o código todo: FALHA FECHADA ────────────────────
--
-- `completo` é o default, então todo vínculo que já existe continua exatamente
-- como está — a coluna é aditiva e ninguém muda de acesso ao aplicá-la.
--
-- Do outro lado, quem tem `projetos` só alcança o que for EXPLICITAMENTE
-- liberado, tela a tela e rota a rota. Tela nova nasce invisível para ele; é
-- preciso um ato deliberado para abri-la. O inverso — liberar por padrão e
-- lembrar de fechar — vaza no dia em que alguém esquece, e o vazamento é a
-- conversa de WhatsApp de um cliente.
-- ============================================================================

alter table public.user_organizations
  add column if not exists escopo text not null default 'completo';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_organizations_escopo_check'
  ) then
    alter table public.user_organizations
      add constraint user_organizations_escopo_check
      check (escopo in ('completo', 'projetos'));
  end if;
end $$;

-- O índice serve à pergunta que a RLS de projetos vai fazer a cada consulta:
-- "esta pessoa, nesta organização, tem escopo de projetos?".
create index if not exists user_organizations_escopo_idx
  on public.user_organizations (organization_id, user_id, escopo);

comment on column public.user_organizations.escopo is
  'A PORTA que esta pessoa usa nesta organização, ortogonal ao papel. `completo` = o CRM inteiro, limitado pelo papel. `projetos` = só a área de Projetos, e dentro dela só o que lhe for atribuído. Default `completo`: a coluna é aditiva e nenhum vínculo existente muda de acesso.';

/**
 * O escopo de quem está logado, para a RLS perguntar sem repetir subconsulta.
 *
 * `security definer` pelo mesmo motivo de `fn_user_org_ids`: a policy precisa
 * ler `user_organizations` de uma pessoa que talvez não possa ler a tabela.
 * `stable` porque não muda dentro da mesma consulta.
 */
create or replace function public.fn_user_escopo(p_org uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select escopo
    from public.user_organizations
   where organization_id = p_org
     and user_id = auth.uid()
     and revoked_at is null
   limit 1;
$$;

revoke all on function public.fn_user_escopo(uuid) from public, anon;
grant execute on function public.fn_user_escopo(uuid) to authenticated, service_role;

comment on function public.fn_user_escopo(uuid) is
  'O escopo de acesso de quem está logado na organização dada. Usada pelas policies da área de Projetos.';
