import { DockerfileParser, From, type Instruction } from "dockerfile-ast";

type DockerfileStage = {
  readonly baseImage: string | null;
  readonly instructions: readonly Instruction[];
};

/** Parses literal instructions of the final stage and its explicitly inherited named stages. */
export function parseFinalDockerfileStage(text: string): DockerfileStage | null {
  if (text.trim() === "") {
    return { baseImage: null, instructions: [] };
  }
  // Keep advanced constructs outside automatic suggestions, including incomplete input.
  if (text.includes("<<") || /^\s*#\s*escape\s*=\s*`/im.test(text)) {
    return null;
  }
  const dockerfile = DockerfileParser.parse(text);
  if (text.trimEnd().endsWith(dockerfile.getEscapeCharacter())) {
    return null;
  }
  const stages = new Map<string, DockerfileStage>();
  let current: DockerfileStage = { baseImage: null, instructions: [] };
  let stageIndex = -1;
  const groups = Map.groupBy(dockerfile.getInstructions(), (instruction) => {
    if (instruction instanceof From) {
      stageIndex += 1;
    }
    return stageIndex;
  });
  for (const instructions of groups.values()) {
    const instruction = instructions.at(0);
    if (instruction instanceof From === false) {
      current = { baseImage: null, instructions };
      continue;
    }
    const args = instruction.getArguments().map((argument) => argument.getValue());
    const image = instruction.getImage();
    if (
      image == null ||
      (args.length !== 1 && (args.length !== 3 || args.at(1)?.toUpperCase() !== "AS"))
    ) {
      return null;
    }
    const parent = stages.get(image.toLowerCase());
    current = {
      baseImage: parent?.baseImage ?? image,
      instructions: [...(parent?.instructions ?? []), ...instructions.slice(1)],
    };
    const stageName = instruction.getBuildStage()?.toLowerCase();
    if (stageName != null) {
      stages.set(stageName, current);
    }
  }
  return current;
}
