import "@testing-library/jest-dom";

// jsdom does not implement Element.prototype.scrollIntoView. @radix-ui/react-select
// (and other Radix popper components) call `candidate?.scrollIntoView()` when
// opening, which throws "candidate?.scrollIntoView is not a function" under
// jsdom and fails any test that mounts a Select. Polyfill it once, globally.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
