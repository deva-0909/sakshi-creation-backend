function convertToPermissionsData(modules) {
  return modules.map((module) => ({
    feature: toTitleCase(module.replace(/_/g, " ")),
    capabilities: defaultActions.map((action) => ({
      type: action.label,
      label: action.label,
    })),
  }));
}

function toTitleCase(str) {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
