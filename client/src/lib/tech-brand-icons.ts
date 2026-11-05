import type { ComponentType } from "react";
import {
  SiAmazonwebservices,
  SiAnthropic,
  SiApachespark,
  SiBootstrap,
  SiCss3,
  SiDjango,
  SiDocker,
  SiFlask,
  SiGit,
  SiGithub,
  SiGooglecolab,
  SiHtml5,
  SiJavascript,
  SiJupyter,
  SiKeras,
  SiLinux,
  SiMongodb,
  SiN8N,
  SiNextdotjs,
  SiNodedotjs,
  SiNumpy,
  SiOpenai,
  SiPandas,
  SiPolars,
  SiPostgresql,
  SiPostman,
  SiPython,
  SiPytorch,
  SiReact,
  SiScikitlearn,
  SiSelenium,
  SiSupabase,
  SiTailwindcss,
  SiTensorflow,
  SiTypescript,
  SiVercel,
  SiWireshark,
} from "react-icons/si";
import { TiHtml5 } from "react-icons/ti";
import { RiClaudeFill, RiNextjsFill } from "react-icons/ri";
import { FaAws, FaGitAlt } from "react-icons/fa";
import { IoLogoVercel } from "react-icons/io5";
import Matplotlib from "@/components/custom-icons/Matplotlib";

type TechIconComponent = ComponentType<{ className?: string; title?: string }>;

export const techIconMap: Record<string, TechIconComponent> = {
  git: SiGit,
  python: SiPython,
  react: SiReact,
  nodejs: SiNodedotjs,
  openai: SiOpenai,
  flask: SiFlask,
  bootstrap: SiBootstrap,
  javascript: SiJavascript,
  html5: SiHtml5,
  html: SiHtml5,
  tihtml5: TiHtml5,
  css3: SiCss3,
  css: SiCss3,
  github: SiGithub,
  tailwindcss: SiTailwindcss,
  nextjs: RiNextjsFill,
  nextdotjs: SiNextdotjs,
  pandas: SiPandas,
  numpy: SiNumpy,
  scikitlearn: SiScikitlearn,
  pytorch: SiPytorch,
  gitalt: FaGitAlt,
  postman: SiPostman,
  vercel: SiVercel,
  iologovercel: IoLogoVercel,
  supabase: SiSupabase,
  n8n: SiN8N,
  claude: RiClaudeFill,
  anthropic: SiAnthropic,
  tensorflow: SiTensorflow,
  linux: SiLinux,
  docker: SiDocker,
  mongodb: SiMongodb,
  postgresql: SiPostgresql,
  postgres: SiPostgresql,
  typescript: SiTypescript,
  aws: SiAmazonwebservices,
  amazon: FaAws,
  django: SiDjango,
  keras: SiKeras,
  jupyter: SiJupyter,
  colab: SiGooglecolab,
  selenium: SiSelenium,
  wireshark: SiWireshark,
  spark: SiApachespark,
  polars: SiPolars,
};

/**
 * Brand/tech stack icon component from react-icons.
 * For matplotlib returns the custom Matplotlib component.
 */
export function getTechBrandIcon(
  iconName: string,
): TechIconComponent | typeof Matplotlib | null {
  const lowerName = iconName.toLowerCase();
  if (lowerName === "matplotlib") {
    return Matplotlib;
  }
  return techIconMap[lowerName] ?? null;
}
