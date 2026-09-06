import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * TAREFA PESSOAL É DE UMA PESSOA — NÃO DA ORGANIZAÇÃO, E NEM DO DONO DO SERVIDOR.
 *
 * ═══ Por que um arquivo próprio, e não uma linha em rls-isolation.test.ts ═══
 *
 * Porque aquele molde semeia UM usuário por organização e prova um eixo só:
 * zero linhas do vizinho. Ele não tem como medir o eixo que define estas duas
 * tabelas — dois usuários da MESMA organização não se veem. Numa lista onde
 * `organization_id` é igual dos dois lados, um teste cross-tenant passa verde
 * com a policy inteiramente removida do recorte por usuário.
 *
 * ═══ As três asserções que importam ═══
 *
 * 1. Cross-tenant, o de sempre.
 * 2. **Cross-USER dentro da mesma org.** É o eixo novo. Se alguém "padronizar"
 *    a policy para o molde org-flat do resto do repo — que é a mudança mais
 *    natural do mundo para quem passa por aqui —, a lista pessoal de cada um
 *    passa a ser lida por toda a equipe, e só este teste percebe.
 * 3. **O platform admin NÃO bypassa.** Todas as outras tabelas do schema deixam
 *    ele passar, e por isso a ausência aqui parece esquecimento — alguém vai
 *    querer "completar" a policy. Numa instalação de revendedor o platform admin
 *    é o REVENDEDOR: o bypass o deixaria ler a lista pessoal de quem contratou.
 *    O racional inteiro está no cabeçalho da migration 0206.
 *
 * Conectar como `postgres` mediria NADA (rolbypassrls = t). Aqui é `set role
 * authenticated` + `request.jwt.claims`, o mesmo caminho que a produção usa.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

function countAs(userId: string, countQuery: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${countQuery}
  `);
  const lines = out.split("\n");
  const last = lines[lines.length - 1];
  if (last === undefined || !/^\d+$/.test(last)) {
    throw new Error(`saída inesperada do psql: ${out}`);
  }
  return Number(last);
}

/** Roda um comando como `authenticated` e devolve se ele foi barrado. */
function escritaBarrada(userId: string, comando: string): boolean {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${comando}
    `);
    return false;
  } catch {
    // A RLS recusa o INSERT com "new row violates row-level security policy",
    // que o psql com ON_ERROR_STOP transforma em saída não-zero.
    return true;
  }
}

// UUIDs próprios: os arquivos de invariante compartilham a base, e reusar os de
// rls-isolation faria os dois disputarem as mesmas linhas.
const ORG_A = "dddddddd-0000-4000-8000-00000000000a";
const ORG_B = "dddddddd-0000-4000-8000-00000000000b";
/** Dois usuários da MESMA organização — o eixo que este arquivo existe para medir. */
const ANA_A = "dddddddd-1111-4000-8000-00000000000a";
const BRUNO_A = "dddddddd-1111-4000-8000-00000000000c";
const CARLA_B = "dddddddd-1111-4000-8000-00000000000b";
/** Dono do servidor. Membro de nenhuma das duas orgs, admin da plataforma. */
const DONO = "dddddddd-1111-4000-8000-00000000000d";

const LISTA_ANA = "dddddddd-2222-4000-8000-00000000000a";
const LISTA_BRUNO = "dddddddd-2222-4000-8000-00000000000c";
const LISTA_CARLA = "dddddddd-2222-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ANA_A}',   'tarefas-ana@invariant.test'),
      ('${BRUNO_A}', 'tarefas-bruno@invariant.test'),
      ('${CARLA_B}', 'tarefas-carla@invariant.test'),
      ('${DONO}',    'tarefas-dono@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'tarefas-inv-a', 'Tarefas Invariant A', 'Tarefas A'),
      ('${ORG_B}', 'tarefas-inv-b', 'Tarefas Invariant B', 'Tarefas B')
      on conflict (id) do nothing;

    -- Ana e Bruno são ADMIN da mesma org: o papel mais alto do tenant, para o
    -- teste provar que nem ele alcança a lista do colega. Fosse 'viewer', a
    -- asserção seria ambígua — poderia estar passando por falta de papel.
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ANA_A}',   '${ORG_A}', 'admin', now()),
      ('${BRUNO_A}', '${ORG_A}', 'admin', now()),
      ('${CARLA_B}', '${ORG_B}', 'admin', now())
      on conflict do nothing;

    insert into public.platform_admins (user_id, granted_by, reason)
      values ('${DONO}', '${DONO}', 'invariante de tarefas pessoais')
      on conflict (user_id) do nothing;

    insert into public.task_lists (id, organization_id, user_id, nome) values
      ('${LISTA_ANA}',   '${ORG_A}', '${ANA_A}',   'Lista da Ana'),
      ('${LISTA_BRUNO}', '${ORG_A}', '${BRUNO_A}', 'Lista do Bruno'),
      ('${LISTA_CARLA}', '${ORG_B}', '${CARLA_B}', 'Lista da Carla')
      on conflict (id) do nothing;

    insert into public.task_items (organization_id, lista_id, user_id, texto)
    select v.org, v.lista, v.dono, 'tarefa sintetica do invariante'
      from (values
        ('${ORG_A}'::uuid, '${LISTA_ANA}'::uuid,   '${ANA_A}'::uuid),
        ('${ORG_A}'::uuid, '${LISTA_BRUNO}'::uuid, '${BRUNO_A}'::uuid),
        ('${ORG_B}'::uuid, '${LISTA_CARLA}'::uuid, '${CARLA_B}'::uuid)
      ) as v(org, lista, dono)
     where not exists (
       select 1 from public.task_items i where i.lista_id = v.lista
     );
  `);
});

for (const tabela of ["task_lists", "task_items"] as const) {
  describe(`${tabela} — a lista é de quem a criou`, () => {
    it("Ana lê as próprias linhas (controle positivo)", () => {
      expect(
        countAs(ANA_A, `select count(*) from public.${tabela} where user_id = '${ANA_A}';`),
      ).toBeGreaterThan(0);
    });

    it("Ana lê ZERO linhas da outra organização", () => {
      expect(
        countAs(ANA_A, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`),
      ).toBe(0);
    });

    it("⚠️ Ana lê ZERO linhas do BRUNO — mesma org, mesmo papel admin", () => {
      // O eixo que distingue estas tabelas de todas as outras do schema. Uma
      // policy org-flat passaria nas duas asserções acima e falharia aqui.
      expect(
        countAs(ANA_A, `select count(*) from public.${tabela} where user_id = '${BRUNO_A}';`),
      ).toBe(0);
    });

    it("Ana não alcança mais nada da tabela inteira além do que é dela", () => {
      // Sem filtro: é assim que um cliente do PostgREST pediria a tabela toda.
      const total = countAs(ANA_A, `select count(*) from public.${tabela};`);
      const proprias = countAs(
        ANA_A,
        `select count(*) from public.${tabela} where user_id = '${ANA_A}';`,
      );
      expect(total).toBe(proprias);
    });

    it("⚠️ o admin de PLATAFORMA não lê nada — exceção deliberada da 0206", () => {
      // Todas as outras tabelas do schema deixam ele passar. Se alguém
      // "completar" a policy com `or fn_is_platform_admin()`, é aqui que estoura.
      expect(countAs(DONO, `select count(*) from public.${tabela};`)).toBe(0);
    });
  });
}

describe("task_lists — escrita", () => {
  it("Ana não cria lista em nome do Bruno: o with check recusa", () => {
    const barrada = escritaBarrada(
      ANA_A,
      `insert into public.task_lists (organization_id, user_id, nome)
         values ('${ORG_A}', '${BRUNO_A}', 'lista forjada pela Ana');`,
    );
    expect(barrada).toBe(true);
  });

  it("Ana não cria lista na organização vizinha", () => {
    const barrada = escritaBarrada(
      ANA_A,
      `insert into public.task_lists (organization_id, user_id, nome)
         values ('${ORG_B}', '${ANA_A}', 'lista forjada na org B');`,
    );
    expect(barrada).toBe(true);
  });

  it("Ana não apaga a lista do Bruno — o delete não alcança linha invisível", () => {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${ANA_A}"}', false);
      delete from public.task_lists where id = '${LISTA_BRUNO}';
    `);
    // Conta como superusuário: a lista do Bruno continua lá.
    const sobrou = Number(
      sql(`select count(*) from public.task_lists where id = '${LISTA_BRUNO}';`),
    );
    expect(sobrou).toBe(1);
  });
});
