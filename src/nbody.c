#include <stdlib.h>
#include <stdio.h>
#include <math.h>

// Create boolean type
typedef int bool;
#define TRUE 1
#define FALSE 0

// Create method type
typedef int method_type;
#define EULER 0
#define VERLET 1
#define RK4 2

// Required constants
#define G		6.6743E-11				// Gravitational constant
#define TIME	86400.0					// Conversion factor from s to d
#define DIST	1.496E+11				// Conversion factor from AU to m
#define ACC		(TIME * TIME) / DIST	// Conversion factor from m/s^2 to AU/d^2
#define SIZE 	9						// Number of bodies (Temporarily set to 9)

// History variables
bool hist_init = FALSE;	// Flag to check if history is initialized
double *hist;			// History of positions of all bodies

// RK4 variables
bool rk4_init = FALSE;	// Flag to check if RK4 variables are initialized
double *y_1, *y_2, *y_3, *y_4, *y_n, *tmp, *k_1, *k_2, *k_3, *k_4;

// Body struct and bodies
typedef struct {
	double mass;		// Mass
	double x, y, z;		// Position
	double vx, vy, vz;	// Velocity
	double ax, ay, az;	// Acceleration
} Body;
Body bodies[9];			// Array of all main 9 bodies in Solar System

// Function prototypes
void euler(double step);
void verlet(double step);
void rk4(double step);

/* Functions used in JavaScript code */

void init_body(int body, double mass, double x, double y, double z, double vx, double vy, double vz) {
	bodies[body].mass = mass;	// Set mass of body

	// Set position vector
	bodies[body].x = x;
	bodies[body].y = y;
	bodies[body].z = z;

	// Set velocity vector
	bodies[body].vx = vx;
	bodies[body].vy = vy;
	bodies[body].vz = vz;
}

void simulate_step(method_type method, double step) {
	switch (method) {
		case EULER:
			euler(step);
			break;
		case VERLET:
			verlet(step);
			break;
		case RK4:
			rk4(step);
			break;
		default:
			printf("Unknown method %d!\n", method);
			break;
	}
}

double *simulate_all(method_type method, unsigned int total_steps, double step) {
	// Check if method is valid
	if (method != 0 && method != 1 && method != 2) {
		printf("Unknown method %d!\n", method);
		return NULL;
	}
	total_steps++;	// Increment total_steps to account for initial positions

	// Check if history array is initialized
	if (hist_init == FALSE) {
		// Allocate memory for history array
		hist = malloc(SIZE * 3 * total_steps * sizeof(double));

		// Make sure memory allocation was successful
		if (hist == NULL) {
			printf("No more memory to allocate!\n");
			return NULL;
		}
		hist_init = TRUE;	// Set flag to true
	}

	// Store initial positions in history
	for (int i = 0; i < SIZE; i++) {
		hist[3 * i + 0] = bodies[i].x;
		hist[3 * i + 1] = bodies[i].y;
		hist[3 * i + 2] = bodies[i].z;
	}

	// Simulate for total_steps
	for (unsigned int t = 1; t < total_steps; t++) {
		// Simulate one step using the specified method
		switch (method) {
			case EULER:
				euler(step);
				break;
			case VERLET:
				verlet(step);
				break;
			case RK4:
				rk4(step);
				break;
		}

		// Store positions in history
		for (int i = 0; i < SIZE; i++) {
			hist[(t * SIZE * 3) + (3 * i) + 0] = bodies[i].x;
			hist[(t * SIZE * 3) + (3 * i) + 1] = bodies[i].y;
			hist[(t * SIZE * 3) + (3 * i) + 2] = bodies[i].z;
		}
	}
	printf("Simulation completed with %d steps using method %d!\n", total_steps, method);
	return hist;
}

/* Returns are all seperate to avoid the use of arrays */

double get_x(int body) {
	return bodies[body].x;
}

double get_y(int body) {
	return bodies[body].y;
}

double get_z(int body) {
	return bodies[body].z;
}

void free_all(void) {
	// Free RK4 variables if initialized
	if (rk4_init == TRUE) {
		free(y_1);
		free(y_2);
		free(y_3);
		free(y_4);
		free(y_n);
		free(tmp);
		free(k_1);
		free(k_2);
		free(k_3);
		free(k_4);
		rk4_init = FALSE;	// Reset flag
	}

	// Free history array if initialized
	if (hist_init == TRUE) {
		free(hist);	
		hist_init = FALSE;	// Reset flag
	}
}

/* Helper functions */

void set_acc(void) {
	for (int i = 0; i < SIZE; i++) {
		bodies[i].ax = 0.0;
		bodies[i].ay = 0.0;
		bodies[i].az = 0.0;
	}

	for (int i = 0; i < SIZE - 1; i++) {
		for (int j = i + 1; j < SIZE; j++) {
			// Compute vector
			double dx, dy, dz;
			dx = DIST * (bodies[j].x - bodies[i].x);
			dy = DIST * (bodies[j].y - bodies[i].y);
			dz = DIST * (bodies[j].z - bodies[i].z);

			// Square root of vector
			double r = sqrt((dx * dx) + (dy * dy) + (dz * dz));

			// Compute acceleration and assign to each body
			double mag = (ACC * G) / (r * r * r);
			double m1 = bodies[j].mass;
			double m2 = bodies[i].mass * -1.0;

			// Compute acceleration vector of first body
			bodies[i].ax += mag * m1 * dx;
			bodies[i].ay += mag * m1 * dy;
			bodies[i].az += mag * m1 * dz;

			// Compute acceleration vector of second body
			bodies[j].ax += mag * m2 * dx;
			bodies[j].ay += mag * m2 * dy;
			bodies[j].az += mag * m2 * dz;
		}
	}
}

void euler(double step) {
	// Compute acceleration for all bodies
	set_acc();

	// Compute new velocity and position
	for (int i = 0; i < SIZE; i++) {
		// Compute new velocity
		bodies[i].vx = bodies[i].vx + (step * bodies[i].ax);
		bodies[i].vy = bodies[i].vy + (step * bodies[i].ay);
		bodies[i].vz = bodies[i].vz + (step * bodies[i].az);

		// Compute new position
		bodies[i].x = bodies[i].x + (step * bodies[i].vx);
		bodies[i].y = bodies[i].y + (step * bodies[i].vy);
		bodies[i].z = bodies[i].z + (step * bodies[i].vz);
	}
}

void verlet(double step) {
	// Compute position at half-step
	for (int i = 0; i < SIZE; i++) {
		bodies[i].x = bodies[i].x + (0.5 * step * bodies[i].vx);
		bodies[i].y = bodies[i].y + (0.5 * step * bodies[i].vy);
		bodies[i].z = bodies[i].z + (0.5 * step * bodies[i].vz);
	}

	// Compute acceleration for all bodies
	set_acc();

	// Compute next half-step
	for (int i = 0; i < SIZE; i++) {
		// Compute new velocity
		bodies[i].vx = bodies[i].vx + (step * bodies[i].ax);
		bodies[i].vy = bodies[i].vy + (step * bodies[i].ay);
		bodies[i].vz = bodies[i].vz + (step * bodies[i].az);

		// Compute new position at the end of the step
		bodies[i].x = bodies[i].x + (0.5 * step * bodies[i].vx);
		bodies[i].y = bodies[i].y + (0.5 * step * bodies[i].vy);
		bodies[i].z = bodies[i].z + (0.5 * step * bodies[i].vz);
	}
}

void f(double *y) {
	// Assign new position
	for (int i = 0; i < SIZE; i++) {
		bodies[i].x = y[6 * i + 0];
		bodies[i].y = y[6 * i + 1];
		bodies[i].z = y[6 * i + 2];
	}

	// Compute acceleration for all bodies
	set_acc();

	// Set values for tmp bodies (acts as return)
	for (int i = 0; i < SIZE; i++) {
		// Velocity
		tmp[6 * i + 0] = y[6 * i + 3];
		tmp[6 * i + 1] = y[6 * i + 4];
		tmp[6 * i + 2] = y[6 * i + 5];

		// Acceleration
		tmp[6 * i + 3] = bodies[i].ax;
		tmp[6 * i + 4] = bodies[i].ay;
		tmp[6 * i + 5] = bodies[i].az;
	}
}

void rk4(double step) {
	// Check if RK4 variables are initialized
	if (rk4_init == FALSE) {
		// Initialize RK4 variables
		y_1 = malloc(SIZE * 6 * sizeof(double));
		y_2 = malloc(SIZE * 6 * sizeof(double));
		y_3 = malloc(SIZE * 6 * sizeof(double));
		y_4 = malloc(SIZE * 6 * sizeof(double));
		y_n = malloc(SIZE * 6 * sizeof(double));
		tmp = malloc(SIZE * 6 * sizeof(double));
		k_1 = malloc(SIZE * 6 * sizeof(double));
		k_2 = malloc(SIZE * 6 * sizeof(double));
		k_3 = malloc(SIZE * 6 * sizeof(double));
		k_4 = malloc(SIZE * 6 * sizeof(double));

		// Make sure memory allocation was successful
		if (y_1 == NULL || y_2 == NULL || y_3 == NULL || y_4 == NULL || y_n == NULL) {
			printf("No more memory to allocate!\n");
			return;
		}
		if (tmp == NULL || k_1 == NULL || k_2 == NULL || k_3 == NULL || k_4 == NULL) {
			printf("No more memory to allocate!\n");
			return;
		}
		rk4_init = TRUE;	// Set flag to true
	}

	// Assign values of y_1
	for (int i = 0; i < SIZE; i++) {
		y_1[6 * i + 0] = bodies[i].x;
		y_1[6 * i + 1] = bodies[i].y;
		y_1[6 * i + 2] = bodies[i].z;
		y_1[6 * i + 3] = bodies[i].vx;
		y_1[6 * i + 4] = bodies[i].vy;
		y_1[6 * i + 5] = bodies[i].vz;
	}

	// Compute k_1
	for (int i = 0; i < SIZE; i++) {
		f(y_1);
		for (int j = 0; j < 6; j++) k_1[6 * i + j] = tmp[6 * i + j];
	}

	// Set y_2 = y + step * k_1 / 2 (using tmp)
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) y_2[6 * i + j] = y_1[6 * i + j] + (0.5 * step * k_1[6 * i + j]);
	}

	// Compute k_2
	for (int i = 0; i < SIZE; i++) {
		f(y_2);
		for (int j = 0; j < 6; j++) k_2[6 * i + j] = tmp[6 * i + j];
	}

	// Set y_3 = y + step * k_2 / 2 (using tmp)
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) y_3[6 * i + j] = y_1[6 * i + j] + (0.5 * step * k_2[6 * i + j]);
	}

	// Compute k_3
	for (int i = 0; i < SIZE; i++) {
		f(y_3);
		for (int j = 0; j < 6; j++) k_3[6 * i + j] = tmp[6 * i + j];
	}

	// Set y_4 = y + step * k_3 (using tmp)
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) y_4[6 * i + j] = y_1[6 * i + j] + (step * k_3[6 * i + j]);
	}

	// Compute k_4
	for (int i = 0; i < SIZE; i++) {
		f(y_4);
		for (int j = 0; j < 6; j++) k_4[6 * i + j] = tmp[6 * i + j];
	}

	// Compute weighted average
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) y_n[6 * i + j] = y_1[6 * i + j] + (step / 6.0) * (k_1[6 * i + j] + (2.0 * k_2[6 * i + j]) + (2.0 * k_3[6 * i + j]) + k_4[6 * i + j]);
	}

	// Set new position, velocity, and history
	for (int i = 0; i < SIZE; i++) {
		// New position
		bodies[i].x = y_n[6 * i + 0];
		bodies[i].y = y_n[6 * i + 1];
		bodies[i].z = y_n[6 * i + 2];

		// New velocity
		bodies[i].vx = y_n[6 * i + 3];
		bodies[i].vy = y_n[6 * i + 4];
		bodies[i].vz = y_n[6 * i + 5];
	}
}
