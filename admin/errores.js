// Errores con mensaje para mostrar al usuario tal cual.
export class ErrorApp extends Error {}
// Otra persona cambió el mismo dato: no se guardó para no pisar su cambio.
export class Conflicto extends ErrorApp {}
