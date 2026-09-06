/**
 * Helper ÚNICO de autorização por role nas rotas /api/v1 (spec 13 §4 — G2-01).
 *
 * Resolve o role efetivo do usuário na org ativa e nega com 403 padronizado
 * (`fail("forbidden_role", ...)`). Nenhuma rota deve reimplementar a checagem
 * na mão (comparação com ROLE_RANK direto em rota é proibida — anti-padrão
 * "matriz advisória").
 *
 * Fluxo:
 *  1. `loadAuthUser()` — valida o JWT via `supabase.auth.getUser()` (nunca
 *     `getSession()`); 401 se não autenticado.
 *  2. `resolveActiveOrg()` — org ativa de fonte confiável (cookie validado
 *     contra memberships), NUNCA do body; 403 `forbidden_tenant` se ausente.
 *  3. `rpc fn_user_role_in_org(org)` — role efetivo direto do banco, a MESMA
 *     função SECURITY DEFINER que as policies RLS usam (fonte única de
 *     verdade); falha fechada se membership foi revogado.
 *  4. Rank insuficiente → audit `authz.denied` (fire-and-forget) + 403.
 */
import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { ESCOPO_PADRAO, ROLE_RANK, type ActiveOrg, type AuthUser, type Escopo, type Role } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

export type RoleCheck =
  | { ok: true; user: AuthUser; org: ActiveOrg }
  | { ok: false; response: NextResponse<ApiError> };

interface RequireRoleOpts {
  /** Correlaciona a resposta e o audit com o X-Request-Id da rota. */
  requestId?: string;
  /** resource_type gravado no audit `authz.denied` (ex.: "api_tokens"). */
  resource?: string;
  /** Platform admin (role transversal) bypassa o rank do tenant. */
  allowPlatformAdmin?: boolean;
  /**
   * Escopos que esta rota aceita. Ausente = só `completo`.
   *
   * ⚠️ FALHA FECHADA, e é o coração da separação do colaborador. Esconder o item
   * do menu não protege nada: `/api/v1/contacts` responde a quem a chamar com um
   * cookie válido, menu ou não. É AQUI que a porta se fecha, no gate único que a
   * doutrina já obriga toda rota a usar.
   *
   * Rota nova nasce fechada ao colaborador. Abri-la é escrever
   * `escopos: ["completo", "projetos"]` — um ato deliberado, visível no diff.
   */
  escopos?: readonly Escopo[];
  /**
   * Override da org onde o role é resolvido (default: org ativa do cookie).
   * Use quando a autorização é sobre a org do RECURSO (ex.: LGPD anonymize —
   * admin na org do CONTATO), resolvida de fonte confiável (query RLS-scoped),
   * NUNCA do body. O role vem de `fn_user_role_in_org(p_org)` nessa org.
   */
  organizationId?: string;
}

/**
 * Gate de rota: `const authz = await requireRole("manager", { requestId });`
 * `if (!authz.ok) return authz.response;`
 */
export async function requireRole(min: Role, opts: RequireRoleOpts = {}): Promise<RoleCheck> {
  const { requestId, resource, allowPlatformAdmin = false, organizationId, escopos } = opts;

  const user = await loadAuthUser();
  if (!user) {
    return { ok: false, response: fail("unauthenticated", "Auth required.", 401, { requestId }) };
  }

  let org: ActiveOrg | null;
  if (organizationId) {
    const membership = user.organizations.find((o) => o.organization_id === organizationId);
    org = membership
      ? {
          orgId: membership.organization_id,
          name: membership.organization_name,
          role: membership.role,
        }
      : allowPlatformAdmin && user.is_platform_admin
        ? { orgId: organizationId, name: "—", role: "viewer" }
        : null;
  } else {
    org = await resolveActiveOrg(user);
  }
  if (!org) {
    return {
      ok: false,
      response: fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId }),
    };
  }

  /*
    O ESCOPO É A PRIMEIRA PORTA — antes do papel e antes do bypass de platform
    admin, pelo mesmo motivo que em `canSee`: papel é escada, escopo é conjunto.
    Perguntar o papel primeiro deixaria um colaborador com papel `viewer` passar
    em toda rota gateada por `requireRole("viewer")`.

    O 403 nomeia o escopo e não o papel: mandar quem tem escopo de projetos
    "pedir um papel maior" o faria pedir o que não resolve.
  */
  const escopoDaPessoa = org.escopo ?? ESCOPO_PADRAO;
  if (!(escopos ?? [ESCOPO_PADRAO]).includes(escopoDaPessoa)) {
    void audit({
      action: "authz.denied",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: resource ?? null,
      requestId,
      metadata: { reason: "escopo_insuficiente", escopo: escopoDaPessoa },
    });
    return {
      ok: false,
      response: fail("forbidden_escopo", "Esta área não faz parte do seu acesso.", 403, {
        requestId,
      }),
    };
  }

  if (allowPlatformAdmin && user.is_platform_admin) {
    return { ok: true, user, org };
  }

  // Role efetivo do banco (não do snapshot do cookie/membership em memória).
  const supabase = await createClient();
  const { data: effectiveRole, error } = await supabase.rpc("fn_user_role_in_org", {
    p_org: org.orgId,
  });
  if (error) {
    return { ok: false, response: fail("internal_error", error.message, 500, { requestId }) };
  }

  const rank = effectiveRole ? (ROLE_RANK[effectiveRole as Role] ?? 0) : 0;

  // MFA como política de SESSÃO, não só de cadastro.
  //
  // O gate de MFA vivia em `app/app/layout.tsx`, e layout não roda em rota de
  // API: uma sessão `aal1` de admin com TOTP cadastrado chamava direto as 33
  // rotas gateadas por `requireRole("admin")` — criar token de API (plaintext
  // mostrado uma vez), convidar membro, LGPD anonymize, publicar agente,
  // credenciais. Pior, o layout perguntava a coisa errada: `isMfaEnrolled()` é
  // "tem fator", não "provou o fator agora".
  //
  // Fica DEPOIS do rank e ANTES do retorno de sucesso, de propósito: quem não
  // tem papel suficiente continua levando 403 por falta de papel, sem que a
  // resposta revele o estado de MFA de quem nem chegaria lá.
  if (rank >= ROLE_RANK[min] && (await mfaEmDivida())) {
    void audit({
      action: "authz.denied",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: resource ?? null,
      requestId,
      metadata: { reason: "mfa_required", effective_role: effectiveRole ?? null },
    });
    return {
      ok: false,
      response: fail(
        "mfa_required",
        "Esta sessão precisa da verificação em duas etapas. Entre novamente com o código do aplicativo.",
        403,
        { requestId },
      ),
    };
  }

  if (rank < ROLE_RANK[min]) {
    // Fire-and-forget: falha de audit alerta, não bloqueia o 403.
    void audit({
      action: "authz.denied",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: resource ?? null,
      requestId,
      metadata: { required_role: min, effective_role: effectiveRole ?? null },
    });
    return {
      ok: false,
      response: fail("forbidden_role", `Permissão insuficiente. Requer role >= ${min}.`, 403, {
        requestId,
      }),
    };
  }

  return { ok: true, user, org: { ...org, role: effectiveRole as Role } };
}
