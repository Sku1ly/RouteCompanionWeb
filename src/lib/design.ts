import { useEffect, useState } from "react";

export type DesignMode = "modern" | "material";

const KEY = "rc-design";

export function useDesign(): { design: DesignMode; setDesign: (d: DesignMode) => void } {
  const [design, setDesignState] = useState<DesignMode>(() => {
    const saved = localStorage.getItem(KEY);
    return saved === "material" ? "material" : "modern";
  });
  useEffect(() => {
    localStorage.setItem(KEY, design);
    document.documentElement.setAttribute("data-design", design);
  }, [design]);
  return { design, setDesign: setDesignState };
}
