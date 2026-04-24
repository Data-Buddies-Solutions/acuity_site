import { Window } from "happy-dom";

const testWindow = new Window({
  url: "http://localhost:3000/",
});

testWindow.Error = Error;
testWindow.TypeError = TypeError;
testWindow.SyntaxError = SyntaxError;

const globalScope = globalThis as unknown as Record<string, unknown>;

globalScope.window = testWindow;
globalScope.document = testWindow.document;
globalScope.navigator = testWindow.navigator;
globalScope.HTMLElement = testWindow.HTMLElement;
globalScope.HTMLButtonElement = testWindow.HTMLButtonElement;
globalScope.HTMLImageElement = testWindow.HTMLImageElement;
globalScope.HTMLInputElement = testWindow.HTMLInputElement;
globalScope.HTMLTextAreaElement = testWindow.HTMLTextAreaElement;
globalScope.Node = testWindow.Node;
globalScope.Text = testWindow.Text;
globalScope.Event = testWindow.Event;
globalScope.MouseEvent = testWindow.MouseEvent;
globalScope.KeyboardEvent = testWindow.KeyboardEvent;
globalScope.CustomEvent = testWindow.CustomEvent;
globalScope.getComputedStyle = testWindow.getComputedStyle.bind(testWindow);
globalScope.requestAnimationFrame = testWindow.requestAnimationFrame.bind(testWindow);
globalScope.cancelAnimationFrame = testWindow.cancelAnimationFrame.bind(testWindow);
