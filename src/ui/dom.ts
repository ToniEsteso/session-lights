export function element(selector: string, root: ParentNode = document): HTMLElement {
  const value = root.querySelector(selector);
  if (!(value instanceof HTMLElement)) throw Error(`Missing HTML element: ${selector}`);
  return value;
}
export function svgElement(selector: string, root: ParentNode): SVGElement {
  const value = root.querySelector(selector);
  if (!(value instanceof SVGElement)) throw Error(`Missing SVG element: ${selector}`);
  return value;
}
export function usageRow(): HTMLElement {
  const template = document.querySelector('#usage-template');
  if (!(template instanceof HTMLTemplateElement)) throw Error('Missing usage template.');
  const row = template.content.firstElementChild?.cloneNode(true);
  if (!(row instanceof HTMLElement)) throw Error('Missing usage row.');
  return row;
}
