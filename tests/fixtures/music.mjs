// Synthetic listening states, never used by the production Worker.
export const states = ['playing','recent','empty','missing','long','error','timeout'];
export function lastfmFixture(state = 'playing') {
  if (!states.includes(state)) throw new Error('Unknown fixture');
  if (state === 'empty') return {recenttracks:{track:[]}};
  if (state === 'missing') return {recenttracks:{track:[{}]}};
  const track = {
    name: state === 'long' ? 'A very long fixture title — 日本語 & café <script>untrusted</script> '.repeat(5) : 'The long way home',
    artist: {'#text': state === 'long' ? 'An ensemble with an exceptionally long name & guest musicians' : 'Example ensemble'},
    album: {'#text':'A listening fixture, not real activity'},
    url:'https://www.last.fm/music/Example/_/Fixture',
    image:[{size:'large','#text':'https://lastfm.freetls.fastly.net/i/u/300x300/fixture.png'}],
    ...(state === 'playing' ? {'@attr':{nowplaying:'true'}} : {date:{uts:String(Math.floor(Date.now()/1000)-240)}}),
  };
  return {recenttracks:{track:[track]}};
}
