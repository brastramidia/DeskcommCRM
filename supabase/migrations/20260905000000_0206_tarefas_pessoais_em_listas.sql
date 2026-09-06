-- ============================================================================
-- 0206 — TAREFAS PESSOAIS, EM LISTAS
--
-- A área "Atividades" do menu. É gestão pessoal de afazeres, no formato do
-- Lembretes do macOS: listas à esquerda, itens à direita.
--
-- ─── Por que NÃO reusa `crm_lead_activities`
--
-- Porque aquela tabela responde a outra pergunta. `crm_lead_activities` é a
-- timeline polimórfica de um LEAD: toda linha existe porque algo aconteceu com
-- um cliente, e o `lead_id` é `not null`. Uma tarefa pessoal ("renovar o
-- certificado", "ligar para o contador") não tem lead, e inventar um faria a
-- timeline do cliente ganhar linhas que não são dele — corrompendo justamente a
-- superfície que o produto vende.
--
-- ─── Por que `user_id` E `organization_id`, e não só um dos dois
--
-- `organization_id` porque a doutrina não abre exceção: toda tabela tenant-aware
-- carrega a coluna e o cascade. `user_id` porque a área é PESSOAL — o dono é a
-- pessoa, não a empresa. Sem ele, "minhas tarefas" seria "as tarefas de todo
-- mundo da organização", que é um produto diferente do que foi pedido.
--
-- ⚠️ `task_items.user_id` é redundante com `task_lists.user_id` — e é
-- deliberado. Sem ele, a policy de cada item precisaria de um subselect na lista
-- a CADA linha avaliada. Com ele, a policy é uma comparação direta e o índice a
-- cobre. A redundância é fechada pela FK: apagar a lista leva os itens, e o
-- `user_id` do item só é escrito pela rota, que o copia da sessão.
--
-- ─── Por que a policy NÃO tem `fn_is_platform_admin()`
--
-- Todas as outras tabelas deste banco deixam o admin de plataforma passar. Aqui
-- não, e é a única exceção deliberada do arquivo: numa instalação de revendedor
-- o platform admin é o REVENDEDOR, e o bypass o deixaria ler a lista pessoal de
-- quem contratou. "Dados da empresa" e "a lista de afazeres de uma pessoa" não
-- são a mesma classe de dado, e o suporte a um cliente nunca precisou ler isto.
-- Consequência aceita: nem o dono do servidor recupera esta tabela pela tela —
-- só pela service key, que é o caminho correto para uma restauração.
-- ============================================================================

create table if not exists public.task_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  nome text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_lists_nome_nao_vazio check (length(btrim(nome)) > 0)
);

-- Duas listas "Trabalho" do mesmo dono é sempre engano, nunca intenção: a
-- segunda nasce de um clique duplo ou de esquecer que a primeira existia. A
-- unique transforma isso num 409 que a tela explica, em vez de duas listas
-- idênticas que só se distinguem abrindo as duas.
create unique index if not exists task_lists_org_user_nome_key
  on public.task_lists (organization_id, user_id, nome);

create index if not exists task_lists_org_user_idx
  on public.task_lists (organization_id, user_id, created_at);

create table if not exists public.task_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lista_id uuid not null references public.task_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  texto text not null,

  concluida boolean not null default false,
  -- QUANDO foi concluída. Não é derivável de `updated_at`: editar o texto de uma
  -- tarefa já concluída mexe no `updated_at` e não na conclusão. É o campo que
  -- permite "o que eu fechei hoje" sem inventar a data.
  concluida_em timestamptz,

  -- ⚠️ DOIS CAMPOS PARA UM PRAZO, e é o conserto de um bug clássico.
  --
  -- "Dia 12" e "dia 12 às 14h" são coisas diferentes. Guardar as duas num
  -- `timestamptz` só obriga a tarefa de dia inteiro a escolher uma hora, e a
  -- escolha natural é meia-noite — que em qualquer fuso a oeste do UTC exibe
  -- como DIA 11. A tarefa pula de dia sozinha, e ninguém entende por quê.
  --
  -- Com o flag, a tela sabe quando MOSTRAR a hora e quando calar sobre ela, e o
  -- instante gravado continua sendo um instante de verdade.
  vence_em timestamptz,
  vence_com_hora boolean not null default false,

  -- 0 = nenhuma, 1 = baixa, 2 = média, 3 = alta. Inteiro e não texto porque a
  -- tela ORDENA por isto: `order by prioridade desc` usa o índice, enquanto um
  -- vocabulário textual exigiria um CASE que nenhum índice cobre. E não é enum
  -- porque a doutrina do repo proíbe enum (difícil de estender num clone).
  prioridade smallint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_items_texto_nao_vazio check (length(btrim(texto)) > 0),
  constraint task_items_prioridade_valida check (prioridade between 0 and 3),
  -- Conclusão e carimbo andam juntos ou não andam. Sem isto, um PATCH que
  -- esquecesse o carimbo criaria tarefa concluída sem data de conclusão — e a
  -- pergunta "o que fechei hoje" passaria a ter resposta incompleta e silenciosa.
  constraint task_items_concluida_tem_carimbo check (concluida = (concluida_em is not null)),
  -- Hora sem data é um estado que a tela não sabe desenhar.
  constraint task_items_hora_exige_data check (not vence_com_hora or vence_em is not null)
);

-- A consulta da tela, na ordem em que ela desenha: pendentes primeiro, as mais
-- urgentes no topo, e entre iguais a que vence antes.
create index if not exists task_items_lista_ordem_idx
  on public.task_items (organization_id, lista_id, concluida, prioridade desc, vence_em);

-- O ÍNDICE DO BADGE. O contador de vencidas roda em toda navegação (é a sidebar
-- inteira), e sem o parcial ele varreria também as concluídas — que crescem para
-- sempre e nunca entram na conta.
create index if not exists task_items_vencidas_idx
  on public.task_items (organization_id, user_id, vence_em)
  where concluida = false and vence_em is not null;

alter table public.task_lists enable row level security;
alter table public.task_items enable row level security;

-- Um predicado só, `for all`: nesta tabela quem lê é quem escreve. Separar
-- select de write daria a impressão de que existe alguém que só lê, e não
-- existe — a lista é de uma pessoa.
drop policy if exists task_lists_own on public.task_lists;
create policy task_lists_own on public.task_lists
  for all
  using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  )
  with check (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

drop policy if exists task_items_own on public.task_items;
create policy task_items_own on public.task_items
  for all
  using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  )
  with check (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon` do baseline alcança
-- toda tabela criada depois dele — inclusive estas duas. Sem o revoke, a lista
-- pessoal fica legível pela anon key, que vai para o browser.
revoke all on public.task_lists from anon;
revoke all on public.task_items from anon;
grant select, insert, update, delete on public.task_lists to authenticated;
grant select, insert, update, delete on public.task_items to authenticated;
grant all on public.task_lists to service_role;
grant all on public.task_items to service_role;

drop trigger if exists trg_task_lists_updated_at on public.task_lists;
create trigger trg_task_lists_updated_at
  before update on public.task_lists
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_task_items_updated_at on public.task_items;
create trigger trg_task_items_updated_at
  before update on public.task_items
  for each row execute function public.fn_set_updated_at();

comment on table public.task_lists is
  'Listas de tarefas PESSOAIS — o dono é o usuário, não a organização. Distinta de crm_lead_activities, que é a timeline de um lead e exige lead_id.';
comment on table public.task_items is
  'As tarefas dentro de uma lista pessoal. Prazo opcional, prioridade 0-3, conclusão carimbada.';
comment on column public.task_items.vence_com_hora is
  'false = prazo de dia inteiro (a tela não mostra hora). Existe para a tarefa de dia inteiro não virar meia-noite e exibir como o dia anterior em fuso a oeste do UTC.';
comment on column public.task_items.user_id is
  'Redundante com task_lists.user_id, de propósito: sem ele a policy do item exigiria um subselect na lista a cada linha avaliada.';
