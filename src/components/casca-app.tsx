"use client";

/**
 * Casca do sistema no padrão do Gueco:
 * - barra do topo: menu (telas menores), marca, relógio, navegação principal
 *   (pílula azul deslizante, só nomes), sol/lua e cartão do usuário;
 * - menu lateral recolhido (só ícones, 69px) que abre ao passar o mouse
 *   (236px, empurrando o conteúdo); no celular vira gaveta pelo botão ☰;
 * - uma seleção só no app: se a tela é do topo, a pílula do menu some, e vice-versa;
 * - entrada da tela a cada troca e janelas animadas (useMovimentoJanelas).
 */
import { useCallback, useEffect, useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  KeyRound,
  ClipboardCheck,
  Wrench,
  UserCheck,
  Globe,
  Megaphone,
  LogOut,
  Menu,
  Settings,
  BarChart3,
  TrendingUp,
  Users,
  Wallet,
  Home,
  LayoutDashboard,
  Building2,
  FileText,
  Receipt,
  ArrowLeftRight,
  Building,
  CalendarDays,
  TrendingDown,
  UserPlus,
  HousePlus,
  FolderOpen,
  BadgeDollarSign,
  BadgePercent,
  DoorOpen,
  IdCard,
  UsersRound,
  Gavel,
  type LucideIcon,
} from "lucide-react";
import { AbasSegmentadas, type ItemAba } from "./abas-segmentadas";
import { BotaoTema } from "./menu-lateral";
import { useMovimentoJanelas } from "@/lib/movimento/useMovimentoJanelas";
import { rotaPermitida } from "@/lib/modos";
import { rotaVisivel, type Permissoes } from "@/lib/dominio/equipe";
import { ProvedorNavegacao, soCaminho, type OpcoesNavegar } from "@/lib/navegacao";

type Item = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  /** Atalho que só aparece para quem NÃO vê esta outra tela (onde ele já é uma aba). */
  seNaoVer?: string;
};

/** Barra do topo: as telas do dia a dia. */
const TOPO: Item[] = [
  { href: "/", rotulo: "Painel", icone: LayoutDashboard },
  { href: "/imoveis", rotulo: "Imóveis", icone: Building2 },
  { href: "/pessoas", rotulo: "Pessoas", icone: Users },
  { href: "/contratos", rotulo: "Contratos", icone: FileText },
  { href: "/faturas", rotulo: "Aluguéis", icone: Receipt },
  { href: "/repasses", rotulo: "Repasses", icone: ArrowLeftRight },
];

/** Atalhos de ícone no canto direito do topo (no celular vão para o fim do menu). */
const ATALHOS: Item[] = [
  { href: "/equipe", rotulo: "Equipe", icone: UsersRound },
  { href: "/configuracoes", rotulo: "Configurações", icone: Settings },
];

/**
 * Menu lateral, em grupos, na ordem da operação: o ciclo do aluguel
 * (da análise do inquilino à manutenção), o atendimento do dia, a parte
 * comercial, a divulgação e, por último, a gestão do escritório.
 */
const LATERAL: { titulo: string; itens: Item[] }[] = [
  {
    titulo: "Locação",
    itens: [
      { href: "/analise", rotulo: "Análise cadastral", icone: UserCheck },
      { href: "/vistorias", rotulo: "Vistorias", icone: ClipboardCheck },
      { href: "/chaves", rotulo: "Chaves", icone: KeyRound },
      { href: "/cobrancas", rotulo: "Cobranças", icone: Bell },
      { href: "/reajustes", rotulo: "Reajustes e índices", icone: TrendingUp },
      { href: "/manutencao", rotulo: "Manutenção", icone: Wrench },
    ],
  },
  {
    titulo: "Atendimento",
    itens: [
      { href: "/agenda", rotulo: "Agenda", icone: CalendarDays },
      { href: "/documentos", rotulo: "Documentos", icone: FolderOpen },
      { href: "/portais", rotulo: "Portal de clientes", icone: DoorOpen },
    ],
  },
  {
    titulo: "Comercial",
    itens: [
      { href: "/comercial", rotulo: "Leads e propostas", icone: UserPlus },
      { href: "/captacao", rotulo: "Captação de imóveis", icone: HousePlus },
      { href: "/vendas", rotulo: "Vendas", icone: BadgeDollarSign },
      { href: "/empreendimentos", rotulo: "Empreendimentos", icone: Building },
      { href: "/comissoes", rotulo: "Comissões", icone: BadgePercent },
      { href: "/corretor", rotulo: "Meu portal (corretor)", icone: IdCard },
    ],
  },
  {
    titulo: "Divulgação",
    itens: [
      { href: "/site", rotulo: "Site e portais", icone: Globe },
      { href: "/marketing", rotulo: "Marketing", icone: Megaphone },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/financeiro", rotulo: "Financeiro", icone: Wallet },
      { href: "/despesas", rotulo: "Despesas", icone: TrendingDown },
      { href: "/relatorios", rotulo: "Relatórios e DIMOB", icone: BarChart3 },
      { href: "/equipe/aprovacoes", rotulo: "Aprovações", icone: Gavel, seNaoVer: "/equipe" },
    ],
  },
];

/** Telas que não estão no menu, mas pertencem a um item dele (acendem o item). */
const PERTENCE_A: Record<string, string> = { "/indices": "/reajustes" };

const TODOS = [...TOPO, ...LATERAL.flatMap((g) => g.itens), ...ATALHOS];

/** A rota está dentro deste item (ele ou uma tela abaixo dele)? */
const dentro = (rota: string, href: string) => rota === href || rota.startsWith(`${href}/`);

function normalizar(caminho: string): string {
  for (const [de, para] of Object.entries(PERTENCE_A)) if (caminho === de || caminho.startsWith(`${de}/`)) return para + caminho.slice(de.length);
  return caminho;
}

function rotaAtiva(caminhoBruto: string): string {
  const caminho = normalizar(caminhoBruto);
  if (caminho === "/") return "/";
  const achado = TODOS.filter((i) => i.href !== "/" && caminho.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return achado?.href ?? "";
}

/** Seção da tela (primeiro trecho do caminho): trocar de seção = tela nova. */
function secao(caminho: string): string {
  return "/" + (normalizar(caminho).split("/")[1] ?? "");
}

type Entrada = { tipo: "tela" | "aba"; dir: number };

function linhaLateral(i: Item): ItemAba {
  const Icone = i.icone;
  return {
    id: i.href,
    titulo: i.rotulo,
    rotulo: (
      <>
        <span className="lateral-ico">
          <Icone className="size-[19px]" strokeWidth={1.9} />
        </span>
        <span className="lateral-txt">{i.rotulo}</span>
      </>
    ),
  };
}

function Relogio() {
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setAgora(new Date());
    const primeiro = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 20_000);
    return () => {
      window.clearTimeout(primeiro);
      window.clearInterval(id);
    };
  }, []);
  return (
    <div className="topo-relogio">
      <span className="t">{agora ? agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
      <span className="d">
        {agora ? agora.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(/\./g, "") : ""}
      </span>
    </div>
  );
}

export function CascaApp({
  nomeOrganizacao,
  email,
  acaoSair,
  emAtraso = 0,
  modo = "imobiliaria",
  permissoes,
  children,
}: {
  nomeOrganizacao: string;
  email: string;
  acaoSair: () => Promise<void>;
  /** Cobranças vencidas sem pagamento (sininho da barra do topo). */
  emAtraso?: number;
  /** No modo "pessoal" não existe repasse ao proprietário. */
  modo?: "imobiliaria" | "pessoal";
  /** Perfil de acesso do usuário (Equipe → Perfis): esconde do menu o que ele não pode ver. */
  permissoes?: Permissoes;
  children: ReactNode;
}) {
  // Cada modo só mostra as telas que existem nele (regras em src/lib/modos.ts)
  // e cada perfil só as que pode ver (src/lib/dominio/equipe.ts).
  const mostrar = useCallback(
    (href: string) => rotaPermitida(href, modo) && (!permissoes || rotaVisivel(href, permissoes)),
    [modo, permissoes],
  );
  const topo = useMemo(() => TOPO.filter((i) => mostrar(i.href)), [mostrar]);
  const lateral = useMemo(
    () =>
      LATERAL.map((g) => ({ ...g, itens: g.itens.filter((i) => mostrar(i.href) && !(i.seNaoVer && mostrar(i.seNaoVer))) })).filter(
        (g) => g.itens.length > 0,
      ),
    [mostrar],
  );
  const atalhos = useMemo(() => ATALHOS.filter((i) => mostrar(i.href)), [mostrar]);
  const caminho = usePathname();
  const router = useRouter();
  const [gavetaAberta, setGavetaAberta] = useState(false);

  // Navegação numa transição: a tela atual fica na frente até a próxima estar pronta.
  const [pendente, iniciar] = useTransition();
  const [pedidoAba, setPedidoAba] = useState<{ caminho: string; dir: number } | null>(null);
  const navegar = useCallback(
    (href: string, opcoes: OpcoesNavegar = {}) => {
      setPedidoAba(opcoes.aba ? { caminho: soCaminho(href), dir: opcoes.dir ?? 0 } : null);
      iniciar(() => router.push(href, { scroll: opcoes.scroll ?? !opcoes.aba }));
    },
    [router],
  );
  const navegacao = useMemo(() => ({ navegar, pendente }), [navegar, pendente]);

  // Como a nova tela entra: troca de aba = cabeçalho parado e só o conteúdo desliza;
  // o resto = a tela sobe em cascata. Decidido na renderização para valer já no 1º quadro.
  const [caminhoAnterior, setCaminhoAnterior] = useState(caminho);
  const [entrada, setEntrada] = useState<Entrada>({ tipo: "tela", dir: 0 });
  if (caminho !== caminhoAnterior) {
    setCaminhoAnterior(caminho);
    setEntrada(pedidoAba?.caminho === caminho ? { tipo: "aba", dir: pedidoAba.dir } : { tipo: "tela", dir: 0 });
    setPedidoAba(null);
  }
  const [telaGrande, setTelaGrande] = useState(true);
  useMovimentoJanelas();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const aplicar = () => setTelaGrande(mq.matches);
    const t = window.setTimeout(aplicar, 0);
    mq.addEventListener("change", aplicar);
    return () => {
      window.clearTimeout(t);
      mq.removeEventListener("change", aplicar);
    };
  }, []);

  const ativa = rotaAtiva(caminho);
  const noTopo = topo.some((i) => i.href === ativa);

  const itensLateral = useMemo<ItemAba[]>(() => {
    const linhas: ItemAba[] = [];
    // Em telas menores a barra do topo não mostra a navegação: ela vem para o menu.
    if (!telaGrande) {
      linhas.push({ id: "g_principal", ehRotulo: true, className: "lateral-grupo", rotulo: "Principal" });
      topo.forEach((i) => linhas.push(linhaLateral(i)));
    }
    for (const g of lateral) {
      linhas.push({ id: "g_" + g.titulo, ehRotulo: true, className: "lateral-grupo", rotulo: g.titulo });
      g.itens.forEach((i) => linhas.push(linhaLateral(i)));
    }
    // No celular a engrenagem do topo some: Configurações vem para o fim do menu.
    if (!telaGrande) atalhos.forEach((i) => linhas.push(linhaLateral(i)));
    return linhas;
  }, [telaGrande, topo, lateral, atalhos]);

  const ir = (href: string) => {
    setGavetaAberta(false);
    if (href !== caminho) navegar(href);
  };

  const inicial = (email || "?").slice(0, 1).toUpperCase();

  return (
    <div className="casca">
      <header className="topo nao-imprimir">
        {pendente && <div className="barra-navegacao" aria-hidden="true" />}
        <div className="topo-esq">
          <button
            type="button"
            className="topo-btn topo-menu"
            onClick={() => setGavetaAberta((v) => !v)}
            aria-label="Abrir ou fechar o menu"
            title="Menu"
          >
            <Menu className="size-[18px]" />
          </button>
          <div className="topo-marca">
            <span className="topo-marca-ico">
              <Home className="size-[18px]" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="topo-marca-nome">Novo Aluguel</div>
              <div className="topo-marca-tag">{nomeOrganizacao}</div>
            </div>
          </div>
          <Relogio />
        </div>

        <nav className="topo-nav">
          <AbasSegmentadas
            variante="nav"
            rotuloAcessivel="Navegação principal"
            valor={noTopo ? ativa : null}
            aoMudar={ir}
            aoPassar={(href) => router.prefetch(href)}
            itens={topo.map((i) => ({ id: i.href, rotulo: i.rotulo }))}
          />
        </nav>

        <div className="topo-dir">
          <button
            type="button"
            className="topo-btn topo-sino"
            onClick={() => ir("/cobrancas/fila")}
            onMouseEnter={() => router.prefetch("/cobrancas/fila")}
            title={emAtraso ? `${emAtraso} cobrança(s) em atraso — cobrar agora` : "Nenhum aluguel em atraso"}
            aria-label={emAtraso ? `${emAtraso} cobranças em atraso` : "Cobranças: avisos de hoje"}
          >
            <Bell className="size-[18px]" />
            {emAtraso > 0 && <span className="topo-sino-num">{emAtraso > 99 ? "99+" : emAtraso}</span>}
          </button>
          {atalhos.map((i) => {
            const Icone = i.icone;
            const aceso = dentro(ativa, i.href);
            return (
              <button
                key={i.href}
                type="button"
                className={`topo-btn topo-config${aceso ? " on" : ""}`}
                onClick={() => ir(i.href)}
                onMouseEnter={() => router.prefetch(i.href)}
                title={i.rotulo}
                aria-label={i.rotulo}
                aria-current={aceso ? "page" : undefined}
              >
                <Icone className="size-[18px]" />
              </button>
            );
          })}
          <BotaoTema className="topo-btn" />
          <div className="topo-usuario">
            <span className="topo-av">{inicial}</span>
            <div className="topo-usuario-txt">
              <span className="topo-usuario-nome">{email.split("@")[0]}</span>
              <span className="topo-usuario-mail">{email}</span>
            </div>
            <form action={acaoSair}>
              <button className="topo-sair" title="Sair" aria-label="Sair">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="casca-linha">
        {gavetaAberta && <div className="gaveta-fundo" onClick={() => setGavetaAberta(false)} aria-hidden="true" />}
        <aside className={`lateral nao-imprimir${gavetaAberta ? " aberta" : ""}`}>
          <nav className="lateral-rolagem">
            <AbasSegmentadas
              variante="lateral"
              rotuloAcessivel="Menu"
              valor={telaGrande && (noTopo || atalhos.some((i) => dentro(ativa, i.href))) ? null : ativa}
              aoMudar={ir}
              aoPassar={(href) => router.prefetch(href)}
              itens={itensLateral}
            />
          </nav>
        </aside>

        <main className="casca-conteudo" data-carregando={pendente ? "1" : undefined}>
          <div
            key={secao(caminho)}
            className="tela"
            data-entrada={entrada.tipo}
            style={{ "--aba-dir": entrada.dir } as CSSProperties}
          >
            <ProvedorNavegacao valor={navegacao}>{children}</ProvedorNavegacao>
          </div>
        </main>
      </div>
    </div>
  );
}
