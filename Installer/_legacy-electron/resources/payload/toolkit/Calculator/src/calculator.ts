import { type MathJsStatic, all, create } from "mathjs";

const math: MathJsStatic = create(all, {});

type EvaluateInput = {
  expression: string;
  precision: number;
};

export type EvaluateResult = {
  success: boolean;
  expression: string;
  normalizedExpression: string;
  precision: number;
  value: string;
  error?: string;
};

const superscriptMap: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
  "⁽": "(",
  "⁾": ")",
};

function normalizeSuperscripts(expression: string): string {
  return expression.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+/g, (value) => {
    const mapped = value
      .split("")
      .map((character) => superscriptMap[character] ?? character)
      .join("");

    return `^(${mapped})`;
  });
}

function normalizeEngineeringSuffixes(expression: string): string {
  const multipliers: Record<string, string> = {
    p: "1e-12",
    n: "1e-9",
    u: "1e-6",
    m: "1e-3",
    k: "1e3",
    M: "1e6",
    G: "1e9",
    T: "1e12",
  };

  return expression.replace(/\b(\d+(?:\.\d+)?)\s*([pnumkMGT])\b/g, (_value, numberPart, suffix) => {
    const multiplier = multipliers[suffix];
    return multiplier ? `(${numberPart}*${multiplier})` : `${numberPart}${suffix}`;
  });
}

function insertImplicitMultiplication(expression: string): string {
  return expression
    .replace(/(\d)\s*([A-DF-Za-df-z])/g, "$1*$2")
    .replace(/(\))\s*([A-Za-z0-9(])/g, "$1*$2")
    .replace(/([A-Za-z])\s*(\()/g, "$1$2");
}

function normalizeExpression(expression: string): string {
  const normalized = normalizeSuperscripts(expression)
    .replace(/[πΠ]/g, "pi")
    .replace(/[×✕✖·]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/[∞]/g, "Infinity")
    .replace(/[μµ]/g, "u")
    .replace(/[Ω]/g, "ohm")
    .replace(/[√]/g, "sqrt")
    .replace(/°/g, " deg")
    .replace(/\bdegrees?\b/gi, "deg")
    .replace(/\s+/g, " ")
    .trim();

  return insertImplicitMultiplication(normalizeEngineeringSuffixes(normalized));
}

export function evaluateExpression(input: EvaluateInput): EvaluateResult {
  const normalizedExpression = normalizeExpression(input.expression);

  try {
    const node = math.parse(normalizedExpression);
    const evaluated = node.compile().evaluate();

    const value = math.format(evaluated, {
      precision: input.precision,
      notation: "auto",
      lowerExp: -9,
      upperExp: 12,
    });

    return {
      success: true,
      expression: input.expression,
      normalizedExpression,
      precision: input.precision,
      value,
    };
  } catch (error) {
    return {
      success: false,
      expression: input.expression,
      normalizedExpression,
      precision: input.precision,
      value: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
