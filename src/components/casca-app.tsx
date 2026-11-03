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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  KeyRound,
  ClipboardCheck,
  Wrench,
  LogOut,
  Menu,
  Percent,
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
  Handshake,
  ListTodo,
  Target,
  TrendingDown,
  UserPlus,
  HousePlus,
  FolderOpen,
  BadgeDollarSign,
  BadgePercent,
  type LucideIcon,
} from "lucide-react";
import { AbasSegmentadas, type ItemAba } from "./abas-segmentadas";
import { BotaoTema } from "./menu-lateral";
import { useMovimentoJanelas } from "@/lib/movimento/useMovimentoJanelas";
import { rotaPermitida } from "@/lib/modos";

type Item = { href: string; rotulo: string; icone: LucideIcon };

/** Barra do topo: as telas do dia a dia. */
const TOPO: Item[] = [
  { href: "/", rotulo: "Painel", icone: LayoutDashboard },
  { href: "/imoveis", rotulo: "Imóveis", icone: Building2 },
  { href: "/contratos", rotulo: "Contratos", icone: FileText },
  { href: "/faturas", rotulo: "Aluguéis do mês", icone: Receipt },
  { href: "/repasses", rotulo: "Repasses", icone: ArrowLeftRight },
];

/** Menu lateral: o restante, em grupos. */
const LATERAL: { titulo: string; itens: Item[] }[] = [
  {
    titulo: "Cadastros",
    itens: [
      { href: "/pessoas", rotulo: "Pessoas", icone: Users },
      { href: "/empreendimentos", rotulo: "Empreendimentos", icone: Building },
      { href: "/documentos", rotulo: "Documentos", icone: FolderOpen },
    ],
  },
  {
    titulo: "Agenda",
    itens: [
      { href: "/agenda", rotulo: "Agenda", icone: CalendarDays },
      { href: "/chaves", rotulo: "Chaves", icone: KeyRound },
      { href: "/vistorias", rotulo: "Vistorias", icone: ClipboardCheck },
    ],
  },
  {
    titulo: "Comercial",
    itens: [
      { href: "/comercial", rotulo: "Leads", icone: UserPlus },
      { href: "/captacao", rotulo: "Captação de imóveis", icone: HousePlus },
      { href: "/vendas", rotulo: "Vendas", icone: BadgeDollarSign },
      { href: "/comissoes", rotulo: "Comissões", icone: BadgePercent },
      { href: "/comercial/propostas", rotulo: "Propostas", icone: Handshake },
      { href: "/comercial/tarefas", rotulo: "Tarefas", icone: ListTodo },
      { href: "/comercial/metas", rotulo: "Metas", icone: Target },
    ],
  },
  {
    titulo: "Locação",
    itens: [
      { href: "/reajustes", rotulo: "Reajustes", icone: TrendingUp },
      { href: "/cobrancas", rotulo: "Cobranças", icone: Bell },
      { href: "/manutencao", rotulo: "Manutenção", icone: Wrench },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/despesas", rotulo: "Despesas", icone: TrendingDown },
      { href: "/financeiro", rotulo: "Financeiro", icone: Wallet },
      { href: "/relatorios", rotulo: "Relatórios e DIMOB", icone: BarChart3 },
      { href: "/indices", rotulo: "Índices econômicos", icone: Percent },
      { href: "/configuracoes", rotulo: "Configurações", icone: Settings },
    ],
  },
];

const TODOS = [...TOPO, ...LATERAL.flatMap((g) => g.itens)];

function rotaAtiva(caminho: string): string {
  if (caminho === "/") return "/";
  const achado = TODOS.filter((i) => i.href !== "/" && caminho.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return achado?.href ?? "";
}

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
  children,
}: {
  nomeOrganizacao: string;
  email: string;
  acaoSair: () => Promise<void>;
  /** Cobranças vencidas sem pagamento (sininho da barra do topo). */
  emAtraso?: number;
  /** No modo "pessoal" não existe repasse ao proprietário. */
  modo?: "imobiliaria" | "pessoal";
  children: ReactNode;
}) {
  // Cada modo só mostra as telas que existem nele (regras em src/lib/modos.ts).
  const topo = useMemo(() => TOPO.filter((i) => rotaPermitida(i.href, modo)), [modo]);
  const lateral = useMemo(
    () => LATERAL.map((g) => ({ ...g, itens: g.itens.filter((i) => rotaPermitida(i.href, modo)) })).filter((g) => g.itens.length > 0),
    [modo],
  );
  const caminho = usePathname();
  const router = useRouter();
  const [gavetaAberta, setGavetaAberta] = useState(false);
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
    return linhas;
  }, [telaGrande, topo, lateral]);

  const ir = (href: string) => {
    setGavetaAberta(false);
    if (href !== caminho) router.push(href);
  };

  const inicial = (email || "?").slice(0, 1).toUpperCase();

  return (
    <div className="casca">
      <header className="topo nao-imprimir">
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
              valor={noTopo && telaGrande ? null : ativa}
              aoMudar={ir}
              aoPassar={(href) => router.prefetch(href)}
              itens={itensLateral}
            />
          </nav>
        </aside>

        <main className="casca-conteudo">
          <div key={ativa || caminho} className="tela">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
