import { describe, expect, it } from "vitest";

import { canSee, searchable, sidebarGroups, NAV_DESTINATIONS } from "@/lib/navigation/registry";

/**
 * O COLABORADOR NÃO VÊ O CRM — e este arquivo existe para isso não regredir.
 *
 * O risco é estrutural, não hipotético: `ROLE_RANK` modela ESCADA, e QUINZE
 * telas do produto não exigem papel nenhum. Um "colaborador" implementado como
 * papel mais baixo enxergaria Inbox, Contatos, Funis e as tarefas pessoais do
 * dono — exatamente o oposto do pedido.
 *
 * Por isso o escopo é ortogonal ao papel, e por isso o default de
 * `NavDestination.escopos` é FECHADO: tela nova nasce invisível ao colaborador.
 * O teste da vez seguinte é o que garante que o default continue valendo.
 */

const dest = (href: string) => {
  const d = NAV_DESTINATIONS.find((x) => x.href === href);
  if (!d) throw new Error(`destino ausente do registro: ${href}`);
  return d;
};

describe("escopo de projetos", () => {
  it("⚠️ o colaborador NÃO vê nenhuma tela do CRM, nem como admin", () => {
    // `admin` de propósito: se o escopo fosse um degrau da escada, o papel mais
    // alto abriria tudo. Ele não abre — a porta é outra.
    for (const href of [
      "/app/inbox",
      "/app/contacts",
      "/app/kanban",
      "/app/tarefas",
      "/app/metrics",
      "/app/connections",
      "/app/team",
    ]) {
      expect(canSee(dest(href), false, "admin", "projetos"), href).toBe(false);
    }
  });

  it("o colaborador vê Projetos", () => {
    expect(canSee(dest("/app/projetos"), false, "viewer", "projetos")).toBe(true);
  });

  it("⚠️ nem o admin de PLATAFORMA escapa do escopo", () => {
    // O bypass de platform admin vem DEPOIS da porta. Se viesse antes, bastaria
    // um colaborador virar platform admin por engano para o escopo evaporar.
    expect(canSee(dest("/app/inbox"), true, "admin", "projetos")).toBe(false);
  });

  it("quem tem acesso completo segue vendo tudo o que via", () => {
    for (const href of ["/app/inbox", "/app/contacts", "/app/tarefas", "/app/projetos"]) {
      expect(canSee(dest(href), false, "admin", "completo"), href).toBe(true);
    }
  });

  it("⚠️ o menu do colaborador tem UM grupo e UM item", () => {
    const grupos = sidebarGroups(false, "admin", "projetos");
    expect(grupos.map((g) => g.group.id)).toEqual(["atividades"]);
    expect(grupos[0]?.items.map((i) => i.href)).toEqual(["/app/projetos"]);
  });

  it("⚠️ a busca (⌘K) também não vaza — era a porta esquecida", () => {
    // O ⌘K é outra projeção do mesmo registro. Fechar só o menu deixaria a busca
    // listando Inbox e Contatos para quem não pode abri-los.
    expect(searchable(false, "admin", "projetos").map((d) => d.href)).toEqual(["/app/projetos"]);
  });

  it("⚠️ O DEFAULT É FECHADO: só Projetos declara `escopos`", () => {
    // Se alguém acrescentar uma tela e esquecer de pensar no colaborador, ela
    // nasce invisível para ele. Este teste falha no dia em que alguém abrir uma
    // segunda tela — e aí a decisão passa a ser deliberada, lida no diff.
    const abertos = NAV_DESTINATIONS.filter((d) => d.escopos?.includes("projetos"));
    expect(abertos.map((d) => d.href)).toEqual(["/app/projetos"]);
  });
});
