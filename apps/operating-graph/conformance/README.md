# Operating-view application conformance

These fixtures pin the `atrib.operating-event.v1` application projection. They
do not define a protocol profile and do not replace atrib record-signature
conformance.

An implementation passes when it:

- preserves two active heads as a conflict;
- accepts a resolution only when it names and cites every active head;
- returns the selected accepted head after that resolution;
- keeps named agents in the bounded view; and
- makes a handed-off task visible to its receiving agent.

The repository test reads the JSON fixture directly. Independent clients can
publish the same expected result without adopting this reference UI.
