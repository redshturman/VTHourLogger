# VisualTimeSetter

Aplicación local e independiente para preparar solicitudes históricas de
**fichaje no realizado** en Cegid Visualtime Portal.

**Estado real: adaptador de carga y guardado implementado a partir del
diagnóstico autenticado del usuario y del JavaScript público del portal.
El usuario ha confirmado guardados reales, pero también un rechazo `-50`
automatizado para una solicitud que después pudo guardar manualmente.
La corrección de aislamiento entre fichajes aún requiere confirmación en el
portal real.**
Se usa el botón Guardar del formulario, no una API llamada directamente ni
el fichaje rápido. La integración se comprueba al conectar y exige una prueba
de carga sin guardar antes de habilitar la confirmación del envío.

## Arrancar en Windows

Requiere Node.js 20 o posterior y Microsoft Edge instalado.

Haz doble clic en `Iniciar.cmd`: instala las dependencias si faltan, inicia el
servidor y abre `http://127.0.0.1:4317`. Mantén la consola abierta mientras lo
usas. Cierra con Ctrl+C. También puedes ejecutar:

```powershell
npm install
npm start
```

El servidor escucha exclusivamente en `127.0.0.1`, no en la red local.
No ejecutes dos copias simultáneas ni compartas el puerto mediante un túnel.
Solo debes iniciar una copia desde esta carpeta.

## Preparar el periodo

1. Introduce fecha inicial y final inclusivas en **dd/mm/aaaa**, y las horas
   realmente trabajadas en formato de **24 horas HH:mm** (por ejemplo, 08:00
   y 18:00). Los campos no dependen del formato regional del navegador.
   Usa Calendario para elegir una fecha y Hora para seleccionar hora y minuto
   en los desplegables, o escribe directamente el valor.
2. Genera la vista previa. Los lunes a viernes aparecen marcados; sábados y
   domingos se muestran desmarcados y bloqueados, sin horas y nunca se envían.
   Seleccionar todos solo afecta a los días laborables.
3. Desmarca manualmente vacaciones, festivos y cualquier otro día que no corresponda.

Cada día seleccionado representa una Entrada y una Salida de tipo Presencia.
No se añaden ni modifican Motivo u Observaciones. Un mismo horario se aplica a
todos los días seleccionados. Esta versión admite solo turnos dentro del mismo
día; rechaza salidas iguales o anteriores a la entrada para no asignarlas a una
fecha incorrecta. No consulta festivos ni fichajes existentes en el portal.

Las solicitudes requieren validación del supervisor: **enviada no significa
aprobada**. No se utiliza el botón Entrar ni el fichaje rápido del día actual.

## Conectar y cargar las horas

1. En la aplicación, pulsa **Abrir portal en Edge**. Se abre una ventana separada.
2. Inicia sesión tú mismo en Visualtime, también con SSO/MFA si corresponde.
   No compartas tu contraseña. La aplicación no rellena el inicio de sesión.
3. Abre **Solicitar → Fichaje no realizado**, sin pulsar el disquete de guardar.
4. Vuelve a la aplicación y pulsa **Conectar formulario**. Se comprueban en
   modo de solo lectura la cuenta personal, la nueva solicitud, los controles
   DevExtreme y que el tipo sea Presencia y Motivo/Observaciones estén vacíos.
   El resultado aparece junto al botón. Presencia se comprueba por su ID
   del widget (`1` numérico o textual), no por el primer input del desplegable,
   que DevExtreme puede generar como campo oculto.
5. Con el periodo generado y los días revisados, pulsa **Probar carga sin
   guardar**. Carga la primera entrada seleccionada. Mira los campos en Edge:
   fecha, hora y sentido. No pulses el disquete.
6. Vuelve a VisualTimeSetter y pulsa **Confirmar y enviar** únicamente si los
   datos son correctos y quieres enviar el lote. Se volverá a intentar todo lo
   seleccionado aunque conste como enviado o existente en el registro local.
   No manipules Edge durante el envío. El progreso aparece por solicitud.

No empieza a cargar automáticamente al abrir el portal ni al iniciar sesión.
Antes de cada carga se recarga completamente el documento en la ruta de la
nueva solicitud. No se reutilizan las vistas ni los servicios que el enrutador
de Visualtime mantiene en memoria. Esto incluye Entrada y Salida del mismo día
y la primera carga sin guardar. Como Visualtime vuelve a Inicio al arrancar,
primero se espera ese arranque autenticado y después se navega al formulario;
no se depende de que respete el hash anterior a la recarga.
Se vuelve a verificar la cuenta y se espera a
que estén visibles e inicializados todos los controles, incluido Sentido:
el cambio de ruta por sí solo no indica que el formulario haya terminado de
renderizar. Si la recarga exige iniciar sesión de nuevo o cambia la cuenta,
no se pulsa Guardar.
Cuando actualices el código, cierra con Ctrl+C la consola anterior y vuelve a
ejecutar `Iniciar.cmd`; recarga la interfaz y conecta la nueva ventana de Edge.
La sesión del navegador anterior no se transfiere al nuevo proceso.
Si un lote se detuvo con solicitudes no intentadas, conserva `data\journal.json`,
genera el mismo periodo con las mismas horas y vuelve a conectar, probar la
carga y confirmar. Se vuelve a intentar toda la selección; el portal decide
cuáles siguen existiendo. Revisa los resultados inciertos en el portal: un
nuevo envío confirmado también los volverá a intentar.

El botón adicional **Inspeccionar formulario (solo lectura)** sirve para
diagnosticar cambios del portal. No carga campos ni guarda solicitudes.
Extrae metadatos de controles visibles, etiquetas y botones, no los
valores de inputs, observaciones, contraseñas o cookies. Puede contener textos
identificativos del portal: revísalo antes de compartirlo. El diagnóstico solo
se guarda si lo descargas.

La sesión de Edge es temporal, no tu perfil habitual. No se exportan cookies,
contraseñas ni `storageState`. Al cerrar el proceso se pierde la autenticación.
Se comprueba que no hay suplantación de empleado y se vincula el lote a una
huella de cuenta/empresa/servidor. No se leen ni exportan tokens para guardar.
Solo cambian las opciones `value` de `dxDateBox: beginDate` y
`dxSelectBox: cmbRequestValue1`; después se comprueban todos los campos.
No se borran Motivo u Observaciones si contienen algo: se bloquea el envío.
La zona del navegador automatizado es Europe/Madrid; se rechazan horas futuras
o inexistentes por cambio de horario.

La fuente pública del portal identifica `SaveRequestForbiddenPunch` y un acuse
`d.Status === 0`. El adaptador solo pulsa el botón Guardar; observa su petición,
resuelve la ruta relativa del servicio (`/api/Portalsvcx.svc`) contra la URL
actual del portal,
comprueba fecha/hora/sentido/Motivo/Observaciones y que no acepta advertencias,
y lee el acuse JSON de la respuesta a esa misma petición validada, identificada
por su objeto de petición (no por una URL aproximada). También observa el callback
`onSuccessCall` de `saveForbbidenPunch` y comprueba su código si lo recibe; la
ausencia de ese callback no impide reconocer la respuesta del servidor ni cerrar
el aviso de duplicado. La observación
se instala antes del clic y se retira al terminar; no llama al servicio por su
cuenta y bloquea invocaciones repetidas o con parámetros diferentes. El control
de la petición sigue comprobando el origen, la ruta y los campos multipart,
sin depender de que una URL de respuesta coincida literalmente (puede incluir
una query). Exige el acuse más la salida del formulario antes de avanzar. Si el servidor
no devuelve un identificador de solicitud, el registro conserva una descripción
del acuse, **no inventa un ID oficial**. No basta con que desaparezca el formulario
ni con un HTTP 200. No se aceptan advertencias automáticamente.
Si el portal responde `PunchWithoutRequest: true`, informa de que el portal ha
registrado directamente el fichaje y detiene el lote para revisión.

## Duplicados y resultados

El motor y el adaptador se han probado con respuestas interceptadas, sin
enviar solicitudes reales. Antes de guardar:

- Requiere confirmación explícita y una cuenta identificada por un adaptador
  conectada y una prueba de carga sin guardar; nunca basta con que el navegador
  esté abierto.
- Registra en `data\journal.json` una intención incierta antes de cada escritura.
  Una solicitud solo se marca enviada si hay confirmación verificable.
- El journal no es la fuente de verdad sobre la existencia de fichajes:
  cada nuevo envío confirmado vuelve a intentar todos los elementos seleccionados,
  incluidos enviados, existentes, rechazados e inciertos, incluso tras reiniciar.
  Así pueden recrearse registros borrados en el portal sin borrar el journal.
- Si el portal devuelve `-50` (solicitud repetida) o `-51` (fichaje existente),
  espera a que aparezca el botón Cerrar visible, cierra únicamente el aviso,
  y continúa con el siguiente sin repetir ni aceptar advertencias. `-50` se
  registra como rechazado con el texto visible del aviso, no como prueba de
  una solicitud existente: puede no localizarse en la lista. Solo `-51` se
  registra como existente según la respuesta del portal. No lo cuenta como una
  nueva solicitud enviada ni como aprobación. Un duplicado antiguo
  no prueba que siga existiendo.
- Cada elemento se intenta una sola vez por lote. Si falla, se registra como
  rechazado, incierto o no intentado y se pasa al siguiente; no se repite en
  bucle. En un nuevo lote confirmado se vuelve a intentar, cualquiera que sea
  su estado anterior. El journal conserva información, nunca decide si existe.
- Antes de preparar el siguiente, espera a que el portal deje de tener peticiones
  pendientes y puede cerrar avisos mediante Cerrar. No acepta advertencias ni
  solapa escrituras pendientes. Si la sesión o los controles no permiten enviar,
  lo informa como no intentado; los fallos de disco detienen el lote.
- Si no puede persistir la intención, no intenta escribir en el portal.

No necesitas borrar ni editar el registro para reintentar. Revisa primero el
portal ante un resultado incierto: puede haberse guardado aunque no se recibiera
el acuse. La confirmación del nuevo lote advierte expresamente de este riesgo.
El registro contiene fechas, horarios y referencias de solicitudes, no
credenciales. Consérvalo privado. No consulta por adelantado los registros del
portal; solo marca existente tras la respuesta actual `-51`; `-50` es un rechazo. Esto
también cubre registros creados manualmente o desde otro equipo. No considera
duplicado un fichaje de hora diferente: revisa siempre fechas y horas.

## Validación local sin solicitudes reales

```powershell
npm test
npm run test:ui
```

Pruebas con Node y Edge en modo headless: calendario inclusivo, dos meses,
exclusión, años bisiestos y cambios de hora; selección y confirmación; persistencia,
duplicados, interrupciones y fallos de disco; rutas HTTP y bloqueo de escrituras;
interfaz de escritorio/móvil, inspección y guardado de una fixture interceptada;
acuse válido, respuesta inválida, datos de salida alterados, cambio de cuenta,
rechazo y registro directo del servidor. Todas las peticiones de la fixture se
interceptan, sin llegar al portal real.
`test-results\preview.png` contiene una captura de la vista previa de prueba.
Estas pruebas **no acreditan compatibilidad con el portal real** y no crean
solicitudes allí.
