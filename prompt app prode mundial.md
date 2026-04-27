# Prompt app PRODE Mundial 2026
Quiero crear una pequeña web app para el PRODE del proximo mundial de la FIFA. Algunas consuderaciones
- debe permitir crear diferentes torneos para diferentes grupos de amigos.
- Yo voy a crear los torneos y asociarle los nombres a cada uno.
- el usuario no va a crearse una cuenta. Tal vez podamos crearle un link único para él así puede acceder fácilmente.
- los posibles resultados para la fase de grupos son L, E, V.
- los posibles resultados para la fase final son L y V. Se tiene en cuenta el ganador después de posibles penales.
- Los resultados reales los voy a cargar yo como admin.
- Los partidos de grupos ya están definidos, por lo que sería bueno que me los precargues.
- Los partidos de 16vos de final, los cargo yo a mano. El resto se debe autocompletar en base a los resultados.
- Los resultados una vez enviados no pueden ser modificados por el usuario.
- Mecánica del juego:
  El juego se dividirá en 2 partes: la Fase GRUPOS y después la Fase FINAL. Además hay un bonus por acertar al Campeón, Subcampeón, Tercero y Cuarto.
  El ganador será el que acumule mayor cantidad de puntos entre las 2 fases más el Bonus.

  Fase GRUPOS:
  Hay 3 resultados posibles: Local (L), Empate (E) o Visitante (V).
  Por cada resultado acertado se otorga 1 punto.

  Fase FINAL:
  Hay 2 resultados posibles: Local (L) o Visitante (V), por lo tanto se considera para el resultado el equipo que pase de ronda.
  Para completar esta fase sería bueno que se vayan poniendo los nombres de cada país segun se completó la fase anterior
  Por cada resultado acertado se dará la puntuación según lo siguiente:
  - 16vos de Final: 1 punto
  - Octavos de Final: 2 punto.
  - Cuartos de Final: 4 puntos.
  - Semifinales: 8 puntos.
  - Tercer Puesto: 16 puntos.
  - Final: 24 puntos.

  Para poder sumar puntos de Octavos de Final en adelante se debe haber acertado con el resultado anterior correspondiente.

  - Ejemplo contundente: si en 16vos de Final no se acierta ningún resultado, entonces no se va a puntuar nada para el resto de la Fase Final.

  - Ejemplo detallado: Suponiendo que se acertaron todos los resultados de 16vos de Final, de Octavos de Final y de Cuartos de Final, y quedando en las Semifinales Argentina vs Francia y Brasil vs Alemania, que después pasan a la final Argentina y Brasil y que Argentina sale campeón. Entonces, estas son las diferentes alternativas según se apueste para la final:
    - Argentina y Alemania a la final, sale campeón Argentina: Suma puntos. Porque se acertó que Argentina llega a la final y que salió Campeón. No importa que no se acierte el rival.
    - Argentina y Brasil a la final, sale campeón Brasil: 0 Puntos. Por que, si bien se acertó con los 2 equipos en llegar a la final, no se acertó quién ganaba.
    - Brasil y Alemania a la final, sale campeón cualquiera: 0 Puntos. Por que no se acertó en quienes llegaban a la final. No importa el resultado que se haya puesto.

Bonus: Se completa por única vez con la Fase GRUPOS y no se puede modificar posteriormente
- Campeón: 8 puntos.
- Subcampeón: 6 puntos.
- Tercero: 4 puntos.
- Cuarto: 2 puntos.

La App tiene que ser liviana y ágil, podríamos usar typescript y alguna base de datos liviana, tal vez no-sql tipo mongo o alguna que requiera la mínima instalación (si no necesita instalación, mejor).
El frontend lindo y moderno pero sencillo. Pensalo como mobile first.
