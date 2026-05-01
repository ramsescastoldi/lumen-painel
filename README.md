# Lumen Posto Club — Painel "Posto em Dia"

Painel diário de indicadores para revendedores membros do clube.
Publicado em **https://painel-lumen-posto.netlify.app/**

## Estrutura

```
.
├── index.html          ← painel publicado (gerado a partir do data.json)
├── data.json           ← FONTE DE VERDADE diária. SÓ ESSE arquivo muda no dia-a-dia.
├── update.mjs          ← injeta data.json em index.html
├── package.json        ← scripts npm
├── netlify.toml        ← config do site (cache, headers)
└── .github/workflows/
    └── daily.yml       ← roda diariamente às 07:30 BRT, regenera e publica
```

## Rotina diária

1. Edita `data.json` com os números do dia (manual, ou cola o boletim no Cowork e eu cuspo o JSON pronto).
2. Faz commit no GitHub.
3. Netlify republica em ~10 segundos. Pronto.

## Atualização local (alternativa)

```bash
npm install
npm run deploy        # injeta data.json + sobe pro Netlify
```

## Estrutura do `data.json`

Cada chave do JSON corresponde a uma seção do painel:
- `meta` · data, hora da última atualização
- `manchete` · headline do dia (severity: red | yellow | green)
- `petroleo` · Brent, WTI
- `moedas` · USD/BRL, EUR/BRL, DXY, BTC
- `bolsas` · Ibov, S&P, Nasdaq, Dow
- `juros` · Selic, Fed, UST 10Y
- `inflacao` · IPCA-15, IPCA, Focus
- `abicom` · defasagem + dias sem reajuste
- `anp` · síntese semanal por produto
- `cepea` · hidratado por UF + anidro + açúcar
- `eg` · paridade etanol/gasolina + mandato
- `safra` · moagem, ATR, mix, oferta etanol
- `agenda` · próximos eventos
- `radar` · 5 bullets de síntese
- `acao` · 6 movimentos práticos pro posto
- `resumo` · prosa editorial

Bloco fixo Verimo Seguros está hardcoded no HTML — não mexe nesse no dia-a-dia.

## Editor-chefe

**Ramsés Castoldi** · @eusouramses
