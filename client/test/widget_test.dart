import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders placeholder widget', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Text('VoiceClaw'),
        ),
      ),
    );

    expect(find.text('VoiceClaw'), findsOneWidget);
  });
}
