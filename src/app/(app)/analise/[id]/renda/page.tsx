import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calculator, Gauge, HandCoins, Plus, Wallet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Campo, Cartao, Entrada, Indicador } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import {
  ROTULO_SEMAFORO,
  aluguelMaximo,
  comprometimentoPct,
  custoMensal,
  rendaComprovada,
  rendaDeclarada,
  semaforoComprometimento,
} from "@/lib/dominio/analise";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { adicionarRenda } from "../../actions";
import { CamposRenda } from "../../campos";
import { ContadorPct } from "../../contador-pct";
import { carregarAnalise, carregarConfig, nomesEquipe } from "../../dados";
import { LinhaRenda } from "../../linha-renda";

export const metadata: Metadata = { title: "Renda do candidato" };

const TOM = { verde: "sucesso", amarelo: "alerta", vermelho: "perigo", sem_renda: "neutro" } as const;

export default async function RendaAnalise({ params }: PageProps<"/analise/[id]/renda">) {
  const { id } = await params;
  const { supabase, usuario, organizacao } = await obterContexto();
  const [c, cfg, nome] = await Promise.all([carregarAnalise(supabase, id), carregarConfig(supabase, organizacao.id), nomesEquipe(supabase, usuario.id)]);
  if (!c) notFound();
  const { analise: a, rendas } = c;
  const doCandidato = rendas.filter((r) => !r.fiador_id);
  const comprovada = rendaComprovada(rendas);
  const declarada = rendaDeclarada(rendas) || Number(a.renda_declarada ?? 0);
  const pct = comprometimentoPct(a.valor_aluguel, a.valor_encargos, comprovada);
  const sem = semaforoComprometimento(pct, cfg);
  const custo = custoMensal(a.valor_aluguel, a.valor_encargos);
  const maximo = comprovada > 0 ? aluguelMaximo(comprovada, a.valor_encargos, cfg.limite_comprometimento_pct) : null;
  const limite = String(cfg.limite_comprometimento_pct).replace(".", ",");

  return (
    <div className="space-y-6">
      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Renda declarada" icone={<HandCoins />} valor={<Contador valor={declarada} formato="moeda" />} detalhe="o que o candidato informou" />
        <Indicador rotulo="Renda comprovada" icone={<Wallet />} valor={<Contador valor={comprovada} formato="moeda" />} detalhe="soma do que foi comprovado" tom={comprovada > 0 ? "sucesso" : "alerta"} />
        <Indicador
          rotulo="Comprometimento"
          icone={<Gauge />}
          valor={pct === null ? "—" : <ContadorPct valor={pct} />}
          detalhe={`${ROTULO_SEMAFORO[sem]} · ${formatarReais(custo)} de ${formatarReais(comprovada)}`}
          tom={TOM[sem]}
        />
        <Indicador
          rotulo="Aluguel máximo pela regra"
          icone={<Calculator />}
          valor={maximo === null ? "—" : <Contador valor={maximo} formato="moeda" />}
          detalhe={`até ${limite}% da renda, já tirando os encargos`}
        />
      </div>

      <Cartao
        titulo={`Fontes de renda (${doCandidato.length})`}
        acoes={
          <JanelaCadastro rotuloBotao={<><Plus className="size-3.5" /> Incluir renda</>} tamanho="sm" titulo="Nova fonte de renda" acao={adicionarRenda} rotuloSalvar="Incluir" larguraMax="max-w-2xl">
            <input type="hidden" name="analise_id" value={id} />
            <CamposRenda />
            <Campo rotulo="De quem é a renda (se não for o candidato)" dica="Para compor renda com cônjuge ou outro morador. Em branco = do candidato.">
              <Entrada name="titular" placeholder="Ex.: cônjuge — Maria" />
            </Campo>
          </JanelaCadastro>
        }
      >
        {doCandidato.length === 0 ? (
          <p className="text-sm text-mudo">Nenhuma renda cadastrada. Inclua as fontes (salário, pró-labore, aposentadoria…) e preencha o valor comprovado ao conferir os comprovantes.</p>
        ) : (
          <ul className="space-y-3">
            {doCandidato.map((r) => (
              <LinhaRenda key={r.id} r={r} nome={nome} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-right text-xs text-mudo">As alterações são salvas automaticamente.</p>
      </Cartao>

      <Cartao titulo="Como a conta é feita">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-texto-2">
          <li>Comprometimento = (aluguel + encargos) ÷ renda comprovada. Hoje: {formatarReais(custo)} por mês.</li>
          <li>
            Regra da casa: até {limite}% da renda (verde até {String(cfg.alerta_comprometimento_pct).replace(".", ",")}%, amarelo até {limite}%, vermelho acima).{" "}
            <Link href="/analise/regras" className="text-acento hover:underline">
              mudar regra
            </Link>
          </li>
          <li>Só conta a renda comprovada. Renda de cônjuge ou outro morador entra como composição (preencha “de quem é”).</li>
          <li>A renda dos fiadores fica na aba Fiadores e não entra aqui.</li>
        </ul>
      </Cartao>
    </div>
  );
}
