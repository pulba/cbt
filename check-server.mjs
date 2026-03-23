fetch('http://localhost:4321/').then(r => console.log("Server is running!")).catch(e => console.error("Server down", e.cause));
