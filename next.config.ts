import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Voltar a uma aba aberta há menos de 30s é instantâneo (o navegador guarda a tela).
    // Toda ação que grava dados chama revalidatePath, que limpa essa memória na hora.
    staleTimes: { dynamic: 30 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
